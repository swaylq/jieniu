// 服务内调度器的 worker 进程。pm2 托管，scripts/start-scheduler.sh 是唯一启动入口。
//
// 每 30 秒 tick 一次：找到期任务 → 串行跑各步 → 判据求值 → AI 小结 → 落 JobRun → 算下次触发。
//
// 相对导入 + 自建 PrismaClient：~ 别名在 tsx 下不解析，且 src/server/db.ts import 了 ~/env。

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../../generated/prisma";
import { JOBS } from "./jobs";
import { nextFireAfterRun } from "./schedule";
import { runStep, DEFAULT_TIMEOUT_MS } from "./runner";
import { parseJsonResult, evalChecks } from "./checks";
import { narrate } from "./narrate";
import { sendAlertMail, shouldNotify } from "./notify";
import type { Alert, JobDef, JobStatus, Metrics } from "./types";

const db = new PrismaClient();
const TICK_MS = 30_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/**
 * heavy 任务被互斥**连续挡住超过这么久**才记一条 skipped，防止饿死。
 *
 * 阈值必须远大于一条重活的正常时长：被挡是这个互斥的**正常工作状态**
 * （`backfill-announcements` 一轮就 100 秒，`backfill-signals` 可以跑 20 分钟），
 * 早先按「连续挡 3 个 tick = 90 秒」记录，两条重活一撞就留一条假警报。
 */
const BLOCK_ALARM_MS = 2 * 60 * 60 * 1000;

/** jobKey → 本轮连续被挡的起始时刻 */
const blockedSince = new Map<string, number>();
const running = new Set<string>();

function bootCheck(): void {
  const keys = ["OPENROUTER_API_KEY", "ALI_KEY", "ALI_SECRET"] as const;
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length === 0) {
    console.log("[scheduler] ✓ 密钥齐全：AI + 告警邮件可用");
  } else {
    // 只打 key 名，绝不打值。start-scheduler.sh 会 grep 这一行决定退出码。
    console.error(
      `[scheduler] ✗ 缺少密钥 ${missing.join(" / ")} —— 依赖它们的任务会被标 skipped 并告警。` +
        `生产必须用 scripts/start-scheduler.sh 启动（内含 secret exec 注入）。`,
    );
  }
  if (!process.env.OPS_ALERT_EMAIL) {
    console.error("[scheduler] ⚠ 未设 OPS_ALERT_EMAIL —— 告警只落库，不发信");
  }
  if (!process.env.DATABASE_URL) {
    console.error("[scheduler] ✗ 缺 DATABASE_URL，拒绝启动");
    process.exit(1);
  }
}

/**
 * 把 JOBS 里新增的任务补进 JobState；已存在的不动（保留 enabled / nextFire）。
 *
 * **新建的行一律 enabled=false**：worker 一起来就会把「从未跑过」的任务判为立即到期，
 * 若默认启用，第一次启动会当场把 9 条管线全部拉起来——切换纪律是「逐条开」，
 * 不能靠「起完赶紧去关」抢时间（实测抢不过，第一个 tick 是即时的）。
 * 新增任务同理：先落库、确认参数无误，再显式开。
 */
async function ensureStates(): Promise<void> {
  for (const j of JOBS) {
    await db.jobState.upsert({
      where: { key: j.key },
      create: { key: j.key, enabled: false },
      update: {},
    });
  }
}

function jobTimeoutMs(job: JobDef): number {
  return job.steps.reduce((sum, s) => sum + (s.timeoutMs ?? DEFAULT_TIMEOUT_MS), 0);
}

/**
 * 上一轮同任务的指标，用来给 AI 小结做环比。
 * 在 JS 侧挑「最近一条有 metrics 的运行」——Prisma 对可空 Json 列的 null 过滤分
 * DbNull / JsonNull 两种语义，容易写错且静默返回空，不如取最近 10 条自己找。
 */
async function prevMetricsOf(jobKey: string): Promise<Metrics | null> {
  const recent = await db.jobRun.findMany({
    where: { jobKey, status: { in: ["ok", "fail", "timeout"] } },
    orderBy: { firedAt: "desc" },
    take: 10,
    select: { metrics: true },
  });
  for (const r of recent) {
    if (r.metrics && typeof r.metrics === "object" && !Array.isArray(r.metrics)) {
      return r.metrics as Metrics;
    }
  }
  return null;
}

async function fire(job: JobDef): Promise<void> {
  running.add(job.key);
  const startedAt = Date.now();
  const prevMetrics = await prevMetricsOf(job.key);

  await db.jobState.update({
    where: { key: job.key },
    data: {
      runningAt: new Date(startedAt),
      lastFire: new Date(startedAt),
      lastStatus: "running",
    },
  });
  const run = await db.jobRun.create({
    data: { jobKey: job.key, firedAt: new Date(startedAt), status: "running" },
  });
  console.log(`[scheduler] fire ${job.key}`);

  const chunks: string[] = [];
  const metrics: Metrics = {};
  const alerts: Alert[] = [];
  let status: JobStatus = "ok";
  let exitCode: number | null = 0;
  let prevFailed = false;
  let anyRan = false;

  try {
    for (const step of job.steps) {
      if (prevFailed && !step.runEvenIfPrevFailed) {
        chunks.push(`── ${step.name}：前一步失败，跳过 ──`);
        continue;
      }
      const r = await runStep(step, { cwd: ROOT, env: process.env });
      chunks.push(
        `── ${step.name}（${Math.round(r.durationMs / 1000)}s）──\n${r.output}`,
      );

      if (r.skipped === "missing-secret") {
        prevFailed = true;
        if (status === "ok") status = "skipped";
        continue;
      }
      anyRan = true;

      const m = parseJsonResult(r.output);
      if (m) Object.assign(metrics, m);
      if (step.checks?.length) alerts.push(...evalChecks(step.checks, m ?? {}));

      if (r.timedOut) {
        status = "timeout";
        exitCode = r.exitCode;
        prevFailed = true;
      } else if (r.exitCode !== 0) {
        if (status !== "timeout") status = "fail";
        exitCode = r.exitCode;
        prevFailed = true;
      }
    }
    if (!anyRan) status = "skipped";
  } catch (e) {
    status = "fail";
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`[scheduler] ${job.key} 执行抛异常:`, reason);
    chunks.push(`[scheduler] 执行抛异常: ${reason}`);
  }

  const output = chunks.join("\n\n").slice(-32_000);
  const hasMetrics = Object.keys(metrics).length > 0;

  const narration = await narrate(
    {
      title: job.title,
      status,
      alerts,
      metrics: hasMetrics ? metrics : null,
      prevMetrics,
      output,
    },
    { alwaysNarrate: job.alwaysNarrate ?? false },
  );

  const durationMs = Date.now() - startedAt;
  const lastNotified = await db.jobRun.findFirst({
    where: { jobKey: job.key, notifiedAt: { not: null } },
    orderBy: { notifiedAt: "desc" },
  });
  let notifiedAt: Date | null = null;
  if (
    shouldNotify({
      status,
      alertCount: alerts.length,
      lastNotifiedAtMs: lastNotified?.notifiedAt?.getTime() ?? null,
      nowMs: Date.now(),
    })
  ) {
    const sent = await sendAlertMail({
      jobKey: job.key,
      title: job.title,
      status,
      alerts,
      narration,
      output,
      durationMs,
    });
    if (sent) notifiedAt = new Date();
  }

  await db.jobRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      status,
      exitCode,
      output,
      metrics: hasMetrics ? metrics : undefined,
      alerts: alerts.length ? alerts : undefined,
      narration,
      durationMs,
      notifiedAt,
    },
  });
  await db.jobState.update({
    where: { key: job.key },
    data: {
      runningAt: null,
      lastStatus: status,
      // 按**开火时刻**排下一次，不是完成时刻：daily 的语义是「一天只跑一次」，
      // 用完成时刻算会让「锚点前跑完」的任务当天又排一轮（brief-morning 一早跑了三次）。
      nextFire: new Date(nextFireAfterRun(job.schedule, startedAt, Date.now())),
    },
  });

  running.delete(job.key);
  console.log(
    `[scheduler] done ${job.key} ${status} ${durationMs}ms` +
      (alerts.length ? ` · ${alerts.length} 项判据命中` : ""),
  );
}

async function tick(): Promise<void> {
  const now = Date.now();
  const states = await db.jobState.findMany();
  const byKey = new Map(states.map((s) => [s.key, s]));
  // 每轮实时求值：fire() 的 running.add 是同步的（在第一个 await 之前），
  // 所以本 tick 内刚放行的 heavy 会立刻被后面的 heavy 看见。
  const heavyBusy = () => JOBS.some((j) => j.heavy && running.has(j.key));

  for (const job of JOBS) {
    const st = byKey.get(job.key);
    if (!st?.enabled) continue;
    if (running.has(job.key)) continue;

    // 死锁自愈：进程被 kill -9 会留下 runningAt。超过该任务总 timeout 两倍即释放。
    if (st.runningAt) {
      const stuckFor = now - st.runningAt.getTime();
      if (stuckFor < jobTimeoutMs(job) * 2) continue;
      console.error(
        `[scheduler] ${job.key} 的 runningAt 卡了 ${Math.round(stuckFor / 60_000)} 分钟，判定死锁并释放`,
      );
      await db.jobState.update({
        where: { key: job.key },
        data: { runningAt: null },
      });
    }

    // nextFire 为空 = 从未跑过 ⇒ 立即到期。已过期的补跑一次，不补齐错过的所有轮次。
    if (st.nextFire && st.nextFire.getTime() > now) continue;

    if (job.heavy && heavyBusy()) {
      const since = blockedSince.get(job.key) ?? now;
      blockedSince.set(job.key, since);
      const blockedFor = now - since;
      if (blockedFor >= BLOCK_ALARM_MS) {
        blockedSince.delete(job.key);
        const mins = Math.round(blockedFor / 60_000);
        console.error(`[scheduler] ${job.key} 被 heavy 互斥连续挡了 ${mins} 分钟`);
        await db.jobRun.create({
          data: {
            jobKey: job.key,
            status: "skipped",
            finishedAt: new Date(),
            output: `被 heavy 互斥连续挡了 ${mins} 分钟没能开跑——检查是不是某条重活卡死了`,
            durationMs: 0,
          },
        });
      }
      continue;
    }

    blockedSince.delete(job.key);
    // 不 await：一条任务可以跑很久，tick 不能被它堵住。
    void fire(job).catch((e) => {
      running.delete(job.key);
      console.error(`[scheduler] fire ${job.key} 未捕获异常:`, e);
    });
  }
}

async function loop(): Promise<void> {
  bootCheck();
  await ensureStates();
  console.log(
    `[scheduler] 已加载 ${JOBS.length} 条任务，每 ${TICK_MS / 1000}s 巡检一次`,
  );
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error("[scheduler] tick 失败:", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

void loop();
