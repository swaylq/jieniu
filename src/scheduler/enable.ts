// 启停单条任务的小工具。切换期间用，之后仍是改 JobState.enabled 的最省事入口。
//
// 用法：
//   npx tsx src/scheduler/enable.ts on  ingest backfill-announcements
//   npx tsx src/scheduler/enable.ts off daily-digest
//   npx tsx src/scheduler/enable.ts list
//
// 为什么不是直接 `updateMany({ enabled: true, nextFire: null })`：
// nextFire=null 会被判为「立即到期」——对 interval 任务正合适（马上跑一轮验证），
// 但对 daily 任务就是**在错误的钟点跑一次**。切第一批时 backfill-year（锚点 04:30）
// 就这么在 22:45 跑了；同样的手法用在 daily-digest 上就是深夜给真实用户发信。
// 所以 daily 任务按 schedule 算出真正的下次触发，绝不立即放行。

import { PrismaClient } from "../../generated/prisma";
import { JOBS } from "./jobs";
import { nextFireAfter } from "./schedule";

const db = new PrismaClient();

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

async function list(): Promise<void> {
  const states = await db.jobState.findMany({ orderBy: { key: "asc" } });
  console.table(
    states.map((s) => ({
      key: s.key,
      enabled: s.enabled,
      lastStatus: s.lastStatus ?? "—",
      lastFire: fmt(s.lastFire),
      nextFire: fmt(s.nextFire),
    })),
  );
}

async function main(): Promise<void> {
  const [cmd, ...keys] = process.argv.slice(2);

  if (cmd === "list" || !cmd) {
    await list();
    return;
  }
  if (cmd !== "on" && cmd !== "off") {
    throw new Error(`未知命令 ${cmd}——只支持 on / off / list`);
  }
  if (keys.length === 0) throw new Error("要指定至少一个 job key");

  const unknown = keys.filter((k) => !JOBS.some((j) => j.key === k));
  if (unknown.length > 0) {
    throw new Error(`不存在的 job key: ${unknown.join(", ")}`);
  }

  const now = Date.now();
  for (const key of keys) {
    const job = JOBS.find((j) => j.key === key)!;
    if (cmd === "off") {
      await db.jobState.update({ where: { key }, data: { enabled: false } });
      console.log(`✓ ${key} 已关闭`);
      continue;
    }
    // interval 任务：清空 nextFire = 立即跑一轮，正好当场验证。
    // daily 任务：按锚点算出真正的下次触发，绝不在错误的钟点放行。
    const nextFire =
      job.schedule.kind === "interval"
        ? null
        : new Date(nextFireAfter(job.schedule, now));
    await db.jobState.update({
      where: { key },
      data: { enabled: true, nextFire },
    });
    console.log(
      `✓ ${key} 已开启 · ${
        nextFire ? `下次 ${fmt(nextFire)}（锚点 ${job.schedule.atCST}）` : "立即到期"
      }`,
    );
  }

  console.log("");
  await list();
}

main()
  .catch((e) => {
    console.error("[enable] 失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
