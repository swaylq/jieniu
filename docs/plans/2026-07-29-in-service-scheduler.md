# 服务内调度器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把挂在 hermit-ui `/cron` 上的 9 条解牛数据管线，搬进解牛自己的服务：一个 pm2 托管的 worker 进程按表派发，spawn 现有脚本，完全复刻参数与幂等语义，判断与中文小结改由 OpenRouter 承担。

**Architecture:** 新目录 `src/scheduler/` 全新文件，不改那 46 个 `src/scripts/*.ts` 的执行逻辑（只给 3 个巡检脚本加 `--json` 输出）。worker 每 30 秒 tick 一次，从 `JobState` 找到期任务，spawn `node_modules/.bin/tsx src/scripts/<x>.ts`，子进程继承 worker 的 env（含密钥）。运行记录落 `JobRun`，判据由代码求值，AI 只解释不裁决。

**Tech Stack:** TypeScript · tsx · Prisma / PostgreSQL · Next.js 15（admin 页）· vitest · pm2 · OpenRouter（deepseek-chat）· 阿里云 DirectMail

**设计稿：** `docs/specs/2026-07-29-in-service-scheduler.md`

---

## 关键约束（每个 task 都受它约束）

1. **`~` 别名在 tsx 下不解析。** `src/scheduler/**` 一律**相对导入**，且**不能** import `src/server/db.ts`（它 import `~/env`）。scheduler 自己 `new PrismaClient()`，和那 46 个脚本一样。
2. **绝不裸 `catch {}`。** 每个 catch 至少 `console.error` 出错因。
3. **验证命令一律 `cmd > /tmp/x.log 2>&1; echo "EXIT=$?"`**，绝不 `cmd | tail; echo $?`（管道后的 `$?` 是 `tail` 的）。
4. **不跑 `next build` 来「验证」。** 查类型用 `npx tsc --noEmit`，查 lint 用 `npx next lint`。`.next` 是线上那份，build 就是动线上。
5. **提交只 `git add` 明确路径**，绝不 `git add -A`（工作树里有别的 session 的上百个未提交文件）。
6. **`npx tsx -e` 不支持顶层 await**（eval 走 cjs 输出，实测报 `Top-level await is currently not supported with the "cjs" output format`），一律包成 `void (async () => { … })();`。写在**文件**里的 `.ts` 不受影响（`package.json` 是 `"type": "module"`，`import.meta.url` 可用）。

所有 `npx vitest` / `npx tsx` 命令都在 `/Users/mac/claudeclaw/finance-agent/projects/jieniu` 下执行。

---

## 文件结构

**新建**

| 文件 | 职责 |
|---|---|
| `src/scheduler/schedule.ts` | 纯函数：由 `Schedule` 算下次触发时刻 |
| `src/scheduler/redact.ts` | 纯函数：输出脱敏（邮箱掩码） |
| `src/scheduler/checks.ts` | 纯函数：`JSON_RESULT` 解析 + 判据求值 |
| `src/scheduler/types.ts` | `JobDef` / `Step` / `Schedule` / `CheckDef` 等类型 |
| `src/scheduler/jobs.ts` | 9 条任务声明（唯一的配置来源） |
| `src/scheduler/runner.ts` | spawn 单步 / 超时 / 输出收集 |
| `src/scheduler/narrate.ts` | OpenRouter 中文小结 |
| `src/scheduler/notify.ts` | 告警邮件 + 每任务 6 小时节流 |
| `src/scheduler/main.ts` | worker 主循环：tick / 锁 / heavy 互斥 / 落库 |
| `src/scheduler/fixtures/*.ts` | 单测用的假脚本 |
| `src/app/admin/jobs/page.tsx` | 只读运行记录页 |
| `scripts/start-scheduler.sh` | 唯一启动入口 |

**改动**

| 文件 | 改什么 |
|---|---|
| `prisma/schema.prisma` | 加 `JobState` / `JobRun` 两个 model |
| `src/scripts/coverage-report.ts` | 加 `--json`（5 项判据的指标全在这个脚本里） |
| `src/scripts/backfill-check.ts` | 加 `--json`（重复组数 / 研报合规 / 平均绑定数） |
| `src/scripts/dedup-cross-source.ts` | 加 `--max-apply=N` + `--json` |
| `package.json` | `tsx` 移到 `dependencies`；加 `scheduler` script |
| `docs/reference/deploy.md` | 补 scheduler 启停与排查 |
| `../../AGENTS.md` | 铁律改为分治表述 |

**与设计稿的一处偏离：`effective-coverage.ts` 不加 `--json`。** 五项回归判据的指标（完全空白 / 近7天 / 近24h入库 / 热门 thesis / 有绑定代码）**全部**来自 `coverage-report.ts`；`effective-coverage.ts` 是纯诊断报表，它的输出照旧进 `JobRun.output` 和 AI 小结，但没有判据要从它身上取数。少改一个文件（YAGNI）。

---

### Task 1: 两张表 + 迁移

**Files:**
- Modify: `prisma/schema.prisma`（追加到文件末尾）
- Create: `prisma/migrations/<timestamp>_job_state_run/migration.sql`（由 `prisma migrate dev` 生成）

- [ ] **Step 1: 追加两个 model**

在 `prisma/schema.prisma` 末尾追加：

```prisma
/// 服务内调度器：每条任务一行，保存调度状态。worker 重启后靠 nextFire 原样恢复。
model JobState {
  key        String    @id
  lastFire   DateTime?
  nextFire   DateTime?
  lastStatus String?
  enabled    Boolean   @default(true)
  /// 重入锁：非空表示正在跑。超过该任务 timeout 两倍视为死锁，自动释放。
  runningAt  DateTime?
  updatedAt  DateTime  @updatedAt
}

/// 单次运行记录。output 已脱敏（stdout 里有真实用户邮箱）。
model JobRun {
  id         String    @id @default(cuid())
  jobKey     String
  firedAt    DateTime  @default(now())
  finishedAt DateTime?
  /// running | ok | fail | timeout | skipped
  status     String
  exitCode   Int?
  output     String?   @db.Text
  /// 各步 JSON_RESULT 合并后的指标
  metrics    Json?
  /// 命中的判据
  alerts     Json?
  /// AI 小结；未生成时为 null 或 "[AI 小结未生成] …"
  narration  String?   @db.Text
  durationMs Int?
  /// 已就这条运行发过告警信的时刻（节流依据）
  notifiedAt DateTime?

  @@index([jobKey, firedAt])
}
```

- [ ] **Step 2: 生成迁移**

Run: `DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx prisma migrate dev --name job_state_run > /tmp/mig.log 2>&1; echo "EXIT=$?"`

Expected: EXIT=0，`/tmp/mig.log` 里出现 `Your database is now in sync with your schema`，且 `prisma/migrations/` 下多出一个 `*_job_state_run` 目录。

**不要用 `prisma db push`** —— 已提交迁移悄悄过时是本项目踩过的坑。

- [ ] **Step 3: 确认客户端已重新生成**

Run: `grep -c "JobRun" generated/prisma/models.ts; echo "EXIT=$?"`

Expected: 输出一个 ≥1 的数字（`migrate dev` 会自动 `prisma generate`）。若为 0，跑 `npx prisma generate`。

- [ ] **Step 4: 提交**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(scheduler): JobState / JobRun 两张表"
```

---

### Task 2: `schedule.ts` —— 下次触发时刻（TDD）

**Files:**
- Create: `src/scheduler/schedule.ts`
- Test: `src/scheduler/schedule.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `src/scheduler/schedule.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { nextFireAfter, type Schedule } from "./schedule";

/** 把毫秒格式成北京时间 "YYYY-MM-DD HH:mm"，用系统时区库交叉验证我们的定点计算。 */
function cst(ms: number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(ms))
    .replace("T", " ");
}

const noJitter = () => 0.5; // (0.5*2-1)=0 ⇒ 偏移恰好为 0

describe("interval", () => {
  it("无 jitter 时恰好加一个周期", () => {
    const s: Schedule = { kind: "interval", everySec: 1800, jitterSec: 300 };
    const from = Date.UTC(2026, 6, 29, 10, 0, 0);
    expect(nextFireAfter(s, from, noJitter)).toBe(from + 1800_000);
  });

  it("jitter 落在 ±jitterSec 内", () => {
    const s: Schedule = { kind: "interval", everySec: 1800, jitterSec: 300 };
    const from = Date.UTC(2026, 6, 29, 10, 0, 0);
    const lo = nextFireAfter(s, from, () => 0);
    const hi = nextFireAfter(s, from, () => 1);
    expect(lo).toBe(from + 1800_000 - 300_000);
    expect(hi).toBe(from + 1800_000 + 300_000);
  });
});

describe("daily", () => {
  it("当天还没到点 → 落在当天该时刻（北京时间）", () => {
    const s: Schedule = { kind: "daily", atCST: "07:20", jitterSec: 0 };
    const from = Date.UTC(2026, 6, 28, 22, 0, 0); // 北京时间 7-29 06:00
    expect(cst(nextFireAfter(s, from, noJitter))).toBe("2026-07-29 07:20");
  });

  it("当天已过点 → 顺延到次日", () => {
    const s: Schedule = { kind: "daily", atCST: "07:20", jitterSec: 0 };
    const from = Date.UTC(2026, 6, 29, 0, 0, 0); // 北京时间 7-29 08:00
    expect(cst(nextFireAfter(s, from, noJitter))).toBe("2026-07-30 07:20");
  });

  it("北京时间深夜求凌晨点位，不会跳过一整天", () => {
    const s: Schedule = { kind: "daily", atCST: "03:10", jitterSec: 0 };
    const from = Date.UTC(2026, 6, 29, 15, 0, 0); // 北京时间 7-29 23:00
    expect(cst(nextFireAfter(s, from, noJitter))).toBe("2026-07-30 03:10");
  });

  it("jitter 不会把下次触发算到过去", () => {
    const s: Schedule = { kind: "daily", atCST: "07:20", jitterSec: 600 };
    const from = Date.UTC(2026, 6, 28, 23, 19, 0); // 北京时间 07:19，距点位仅 1 分钟
    const next = nextFireAfter(s, from, () => 0); // 最大负偏移 -10min
    expect(next).toBeGreaterThan(from);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/scheduler/schedule.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT 非 0，日志里是 `Failed to resolve import "./schedule"`。

- [ ] **Step 3: 实现**

创建 `src/scheduler/schedule.ts`：

```ts
// 下次触发时刻。纯函数，rand 可注入以便测试。
//
// 两种语义：
//   interval —— 与 hermit-ui 完全一致：now + everySec ± uniform(jitterSec)。
//   daily    —— 锚定北京时间的钟点。hermit-ui 只有 interval，日级任务的钟点会随机游走
//               （实测「AI 早报」漂到了 17:31），所以这一档是新增的。
//
// 中国自 1991 年起无夏令时，Asia/Shanghai 恒为 UTC+8，按固定偏移算即可；
// schedule.test.ts 用 Intl.DateTimeFormat 交叉验证。

export type Schedule =
  | { kind: "interval"; everySec: number; jitterSec: number }
  | { kind: "daily"; atCST: string; jitterSec: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
/** jitter 为负时的兜底：下次触发至少在 1 分钟后，否则会被立刻判为到期而空转。 */
const MIN_LEAD_MS = 60_000;

function jitterMs(jitterSec: number, rand: () => number): number {
  if (jitterSec <= 0) return 0;
  return Math.round((rand() * 2 - 1) * jitterSec * 1000);
}

export function nextFireAfter(
  s: Schedule,
  fromMs: number,
  rand: () => number = Math.random,
): number {
  if (s.kind === "interval") {
    return fromMs + s.everySec * 1000 + jitterMs(s.jitterSec, rand);
  }

  const [hStr, mStr] = s.atCST.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`daily.atCST 格式非法: ${s.atCST}（应为 "HH:MM"）`);
  }

  // 换算到「北京时钟」的时间轴上算当天零点，再换回 UTC 毫秒。
  const cstMs = fromMs + CST_OFFSET_MS;
  const cstMidnight = Math.floor(cstMs / DAY_MS) * DAY_MS;
  let target = cstMidnight + h * 3600_000 + m * 60_000 - CST_OFFSET_MS;
  if (target <= fromMs) target += DAY_MS;

  return Math.max(target + jitterMs(s.jitterSec, rand), fromMs + MIN_LEAD_MS);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/scheduler/schedule.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0，6 个测试全通过。

- [ ] **Step 5: 提交**

```bash
git add src/scheduler/schedule.ts src/scheduler/schedule.test.ts
git commit -m "feat(scheduler): nextFire 计算（interval + 北京时间锚点）"
```

---

### Task 3: `redact.ts` —— 输出脱敏（TDD）

`src/server/alert-mailer.ts:258` 会打 `[alert-mail] → <真实用户邮箱>｜…`。这些输出要落 `JobRun.output`（admin 页公网可达）并送进 OpenRouter，必须先脱敏。

**Files:**
- Create: `src/scheduler/redact.ts`
- Test: `src/scheduler/redact.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `src/scheduler/redact.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("掩码邮箱，只留首字母与域名", () => {
    expect(redact("[alert-mail] → alice@example.com｜投 3 条")).toBe(
      "[alert-mail] → a***@example.com｜投 3 条",
    );
  });

  it("一行里多个邮箱都掩码", () => {
    expect(redact("a@x.com b@y.org")).toBe("a***@x.com b***@y.org");
  });

  it("发件地址同样掩码（宁可多掩，不可漏）", () => {
    expect(redact("MAIL_FROM=noreply@mail.auramate.net")).toBe(
      "MAIL_FROM=n***@mail.auramate.net",
    );
  });

  it("不含邮箱的文本原样返回", () => {
    expect(redact("[signals] 完成：本轮 60 条｜新写信号 25")).toBe(
      "[signals] 完成：本轮 60 条｜新写信号 25",
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/scheduler/redact.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT 非 0，`Failed to resolve import "./redact"`。

- [ ] **Step 3: 实现**

创建 `src/scheduler/redact.ts`：

```ts
// 输出脱敏。alert-mailer 会把真实用户邮箱打进 stdout，而这些输出会①落 JobRun.output
// （/admin/jobs 页公网可达）②送进 OpenRouter。两处都必须掩码后再走。
//
// 策略是「宁可多掩，不可漏」：发件地址也一起掩掉，不做白名单。

const EMAIL_RE =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function redact(text: string): string {
  return text.replace(EMAIL_RE, (_m, first: string, domain: string) => `${first}***${domain}`);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/scheduler/redact.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0，4 个测试全通过。

- [ ] **Step 5: 提交**

```bash
git add src/scheduler/redact.ts src/scheduler/redact.test.ts
git commit -m "feat(scheduler): 输出脱敏（邮箱掩码）"
```

---

### Task 4: `types.ts` + `checks.ts` —— 指标解析与判据求值（TDD）

**Files:**
- Create: `src/scheduler/types.ts`
- Create: `src/scheduler/checks.ts`
- Test: `src/scheduler/checks.test.ts`

- [ ] **Step 1: 先写类型（无测试，纯声明）**

创建 `src/scheduler/types.ts`：

```ts
import type { Schedule } from "./schedule";

export type SecretName = "OPENROUTER_API_KEY" | "ALI_KEY" | "ALI_SECRET";

export type Metrics = Record<string, number | boolean | string>;

export type CheckDef = {
  /** 稳定 id，进 JobRun.alerts */
  id: string;
  /** metrics 里的字段名 */
  metric: string;
  op: "gt" | "gte" | "lt" | "lte" | "eq" | "ne";
  threshold: number | boolean;
  /** 命中时给人看的一句话 */
  message: string;
};

export type Step = {
  name: string;
  /** 相对仓库根，如 "src/scripts/ingest.ts" */
  script: string;
  args: string[];
  /** 该步额外的环境变量，逐字照抄今天 cron 命令行里的 */
  env?: Record<string, string>;
  /** 缺 key → 该步 skipped + 告警；不依赖它的后续步骤照跑 */
  requires?: SecretName[];
  timeoutMs?: number;
  /** 默认 false：前一步失败即中止后续 */
  runEvenIfPrevFailed?: boolean;
  checks?: CheckDef[];
};

export type JobDef = {
  key: string;
  title: string;
  schedule: Schedule;
  /** true = 与其他 heavy 任务全局互斥（并发跑长回填会被系统杀） */
  heavy: boolean;
  steps: Step[];
  /** 全绿也出 AI 小结（日级巡检） */
  alwaysNarrate?: boolean;
};

export type Alert = {
  id: string;
  message: string;
  value: number | boolean | string | null;
  threshold: number | boolean | null;
};

export type JobStatus = "running" | "ok" | "fail" | "timeout" | "skipped";
```

- [ ] **Step 2: 写失败的测试**

创建 `src/scheduler/checks.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { parseJsonResult, evalChecks } from "./checks";
import type { CheckDef } from "./types";

describe("parseJsonResult", () => {
  it("取最后一行的 JSON_RESULT", () => {
    const out = "【抓取活跃度】\n  近24小时新入库: 312\nJSON_RESULT {\"n24\":312}";
    expect(parseJsonResult(out)).toEqual({ n24: 312 });
  });

  it("JSON_RESULT 后面还有别的行也能找到", () => {
    const out = "JSON_RESULT {\"a\":1}\n收尾日志";
    expect(parseJsonResult(out)).toEqual({ a: 1 });
  });

  it("没有 JSON_RESULT 返回 null", () => {
    expect(parseJsonResult("普通输出\n第二行")).toBeNull();
  });

  it("JSON 坏了返回 null，不抛", () => {
    expect(parseJsonResult("JSON_RESULT {坏的")).toBeNull();
  });
});

const DEFS: CheckDef[] = [
  { id: "ingest-24h", metric: "n24", op: "eq", threshold: 0, message: "近24h新入库为 0，ingest 可能挂了" },
  { id: "news-7d", metric: "pctNews7d", op: "lt", threshold: 85, message: "近7天有资讯占比跌破 85%" },
];

describe("evalChecks", () => {
  it("全部达标时不出告警", () => {
    expect(evalChecks(DEFS, { n24: 312, pctNews7d: 91.2 })).toEqual([]);
  });

  it("命中的判据带上实际值与阈值", () => {
    const alerts = evalChecks(DEFS, { n24: 0, pctNews7d: 91.2 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ id: "ingest-24h", value: 0, threshold: 0 });
  });

  it("多项同时命中都要报出来", () => {
    expect(evalChecks(DEFS, { n24: 0, pctNews7d: 80 }).map((a) => a.id)).toEqual([
      "ingest-24h",
      "news-7d",
    ]);
  });

  it("指标缺失算命中——不能静默放过", () => {
    const alerts = evalChecks(DEFS, { pctNews7d: 91.2 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.id).toBe("ingest-24h");
    expect(alerts[0]!.message).toContain("缺少指标");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/scheduler/checks.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT 非 0，`Failed to resolve import "./checks"`。

- [ ] **Step 4: 实现**

创建 `src/scheduler/checks.ts`：

```ts
// 指标提取与判据求值。
//
// 巡检脚本的中文报表是给人看的，别拿正则去爬（脆）。约定：脚本带 --json 时多打一行
// `JSON_RESULT {…}`，worker 只认这一行。
//
// 「指标缺失」按命中处理：脚本改坏了、字段改名了，都不能表现为「一片正确的绿」。

import type { Alert, CheckDef, Metrics } from "./types";

const MARKER = "JSON_RESULT ";

export function parseJsonResult(stdout: string): Metrics | null {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith(MARKER)) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(MARKER.length));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Metrics;
      }
      console.error(`[checks] JSON_RESULT 不是对象，忽略：${line.slice(0, 120)}`);
      return null;
    } catch (e) {
      console.error(
        `[checks] JSON_RESULT 解析失败：${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
  return null;
}

function compare(op: CheckDef["op"], value: number | boolean, threshold: number | boolean): boolean {
  switch (op) {
    case "eq":
      return value === threshold;
    case "ne":
      return value !== threshold;
    case "gt":
      return Number(value) > Number(threshold);
    case "gte":
      return Number(value) >= Number(threshold);
    case "lt":
      return Number(value) < Number(threshold);
    case "lte":
      return Number(value) <= Number(threshold);
  }
}

export function evalChecks(defs: CheckDef[], metrics: Metrics): Alert[] {
  const alerts: Alert[] = [];
  for (const d of defs) {
    const raw = metrics[d.metric];
    if (raw === undefined || raw === null) {
      alerts.push({
        id: d.id,
        message: `判据「${d.id}」缺少指标 ${d.metric}——脚本没打 JSON_RESULT 或字段改名了`,
        value: null,
        threshold: d.threshold,
      });
      continue;
    }
    if (typeof raw === "string") {
      alerts.push({
        id: d.id,
        message: `判据「${d.id}」的指标 ${d.metric} 是字符串（${raw}），无法比较`,
        value: raw,
        threshold: d.threshold,
      });
      continue;
    }
    if (compare(d.op, raw, d.threshold)) {
      alerts.push({ id: d.id, message: d.message, value: raw, threshold: d.threshold });
    }
  }
  return alerts;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/scheduler/checks.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0，8 个测试全通过。

- [ ] **Step 6: 提交**

```bash
git add src/scheduler/types.ts src/scheduler/checks.ts src/scheduler/checks.test.ts
git commit -m "feat(scheduler): 任务类型 + JSON_RESULT 解析与判据求值"
```

---

### Task 5: `coverage-report.ts` 加 `--json`

五项回归判据的指标全部来自这个脚本。人类可读输出**一个字不改**。

**Files:**
- Modify: `src/scripts/coverage-report.ts:118`（`main()` 结尾处追加）

- [ ] **Step 1: 在 `main()` 结尾追加 JSON 输出**

把 `src/scripts/coverage-report.ts` 里这一段：

```ts
  console.log("【抓取活跃度】");
  console.log(`  近24小时新入库: ${n24}`);
  console.log(`  近7天新入库:    ${n7d}`);
}
```

改成：

```ts
  console.log("【抓取活跃度】");
  console.log(`  近24小时新入库: ${n24}`);
  console.log(`  近7天新入库:    ${n7d}`);

  // --json：给服务内调度器的判据用。人类可读输出保持不变，只在末尾多打这一行。
  // 百分比这里算成数值（而不是复用上面的 pct() 字符串），判据要拿它做比较。
  if (process.argv.includes("--json")) {
    const ratio = (a: number, b: number) => (b === 0 ? 0 : Number(((a / b) * 100).toFixed(2)));
    console.log(
      "JSON_RESULT " +
        JSON.stringify({
          companies,
          stocks,
          news,
          blankCompanies: companies - withNews,
          pctNews7d: ratio(w7, companies),
          pctNews30d: ratio(w30, companies),
          pctStockBound: ratio(withStock, companies),
          hotUniverse: hotIds.length,
          pctHotThesis: ratio(hotWithThesis, hotIds.length),
          n24,
          n7d,
        }),
    );
  }
}
```

- [ ] **Step 2: 真库跑一遍，确认 JSON 行出得来**

Run: `DATABASE_URL="postgresql://mac@localhost:5432/jieniu" NODE_ENV=development npx tsx src/scripts/coverage-report.ts --json > /tmp/cov.log 2>&1; echo "EXIT=$?"; tail -1 /tmp/cov.log`

Expected: EXIT=0，最后一行形如
`JSON_RESULT {"companies":5493,"stocks":...,"blankCompanies":0,"pctNews7d":...,"pctStockBound":...,"pctHotThesis":...,"n24":...,"n7d":...}`

**十一个字段必须都在且都是数字。** 夹具照类型声明手写会全绿而线上全空，这一步是真库冒烟，不能跳过。

- [ ] **Step 3: 确认不带 `--json` 时输出没变**

Run: `DATABASE_URL="postgresql://mac@localhost:5432/jieniu" NODE_ENV=development npx tsx src/scripts/coverage-report.ts > /tmp/cov2.log 2>&1; echo "EXIT=$?"; grep -c JSON_RESULT /tmp/cov2.log`

Expected: EXIT=0，`grep -c` 输出 `0`。

- [ ] **Step 4: 提交**

```bash
git add src/scripts/coverage-report.ts
git commit -m "feat(scripts): coverage-report 加 --json（调度器判据取数）"
```

---

### Task 6: `backfill-check.ts` 加 `--json`

**Files:**
- Modify: `src/scripts/backfill-check.ts`（`main()` 结尾处追加）

- [ ] **Step 1: 把体检数字收集起来并在末尾打 JSON**

`main()` 里 `dupes`、`dist`、`reports` / `bad` / `selfBound` 都是既有变量，但 `bad` / `selfBound` 定义在 `else` 块内。先把它们提到块外：

把这一段：

```ts
  if (reports.length === 0) console.log("  （暂无研报）");
  else {
    const bad = reports.filter((r) => isRatingHeadline(r.title));
```

改成：

```ts
  let badCount = 0;
  let selfBoundCount = 0;
  if (reports.length === 0) console.log("  （暂无研报）");
  else {
    const bad = reports.filter((r) => isRatingHeadline(r.title));
    badCount = bad.length;
```

并在同一个 `else` 块里，`const selfBound = …` 之后补一行：

```ts
    selfBoundCount = selfBound.length;
```

然后在 `main()` 的**最后**（第 6 节输出之后、函数右花括号之前）追加：

```ts
  // --json：给服务内调度器的判据用。人类可读输出保持不变。
  // 注意 dupes 的 SQL 带 LIMIT 15，所以 dupeGroups 最多是 15——判据只关心「是不是 0」。
  if (process.argv.includes("--json")) {
    const row = (dist[0] ?? {}) as Record<string, unknown>;
    console.log(
      "JSON_RESULT " +
        JSON.stringify({
          dupeGroups: dupes.length,
          reportRatingHeadlines: badCount,
          reportSelfBound: selfBoundCount,
          avgBoundPerStock: Number(row["平均"] ?? 0),
        }),
    );
  }
```

- [ ] **Step 2: 真库跑一遍**

Run: `DATABASE_URL="postgresql://mac@localhost:5432/jieniu" NODE_ENV=development npx tsx src/scripts/backfill-check.ts --json > /tmp/bc.log 2>&1; echo "EXIT=$?"; tail -1 /tmp/bc.log`

Expected: EXIT=0，最后一行形如
`JSON_RESULT {"dupeGroups":0,"reportRatingHeadlines":0,"reportSelfBound":0,"avgBoundPerStock":12.3}`

四个字段都在且都是数字。

- [ ] **Step 3: 提交**

```bash
git add src/scripts/backfill-check.ts
git commit -m "feat(scripts): backfill-check 加 --json"
```

---

### Task 7: `dedup-cross-source.ts` 加 `--max-apply` + `--json`

今天的 cron 是「先 dry-run 数 N，≤200 再跑一次 `--apply`」——两次全表扫描，中间集合可能变（TOCTOU）。合成一次扫描内判定。

**Files:**
- Modify: `src/scripts/dedup-cross-source.ts:14`、`:61-75`

- [ ] **Step 1: 解析新参数**

把 `const apply = process.argv.includes("--apply");` 改成：

```ts
  const apply = process.argv.includes("--apply");
  const wantJson = process.argv.includes("--json");
  // --max-apply=N：一次扫描内判定「冗余数 ≤N 才删」。今天 cron 是 dry-run 数一遍、
  // 再 --apply 重扫一遍删，两次扫描之间集合会变（TOCTOU），且多一次全表扫描。
  const maxApplyArg = process.argv.find((a) => a.startsWith("--max-apply="));
  const maxApply = maxApplyArg ? Number(maxApplyArg.split("=")[1]) : null;
  if (maxApplyArg && (!Number.isFinite(maxApply) || maxApply! < 0)) {
    throw new Error(`--max-apply 取值非法: ${maxApplyArg}`);
  }
```

- [ ] **Step 2: 改判定与收尾**

把这一段：

```ts
  if (toDelete.length === 0) return;
  if (!apply) {
    console.log("\n(dry-run — 加 --apply 才删。每组保留最早一条，级联清 NewsEntity/解读/收藏。)");
    return;
  }

  // 分批删，避免 in 列表过长
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 500) {
    const r = await db.newsItem.deleteMany({
      where: { id: { in: toDelete.slice(i, i + 500) } },
    });
    deleted += r.count;
  }
  console.log(`\n已删 ${deleted} 条跨源冗余（个股公告页/自选早报去重）。`);
}
```

改成：

```ts
  const overLimit = maxApply !== null && toDelete.length > maxApply;
  const willApply = toDelete.length > 0 && (apply || maxApply !== null) && !overLimit;

  if (overLimit) {
    console.log(
      `\n⚠ 冗余 ${toDelete.length} 条 > 上限 ${maxApply}，本轮不删——异常暴增，先让人看。`,
    );
  } else if (toDelete.length === 0) {
    console.log("\n无跨源冗余。");
  } else if (!willApply) {
    console.log("\n(dry-run — 加 --apply 才删。每组保留最早一条，级联清 NewsEntity/解读/收藏。)");
  }

  let deleted = 0;
  if (willApply) {
    // 分批删，避免 in 列表过长
    for (let i = 0; i < toDelete.length; i += 500) {
      const r = await db.newsItem.deleteMany({
        where: { id: { in: toDelete.slice(i, i + 500) } },
      });
      deleted += r.count;
    }
    console.log(`\n已删 ${deleted} 条跨源冗余（个股公告页/自选早报去重）。`);
  }

  if (wantJson) {
    console.log(
      "JSON_RESULT " +
        JSON.stringify({ scanned: items.length, redundant: toDelete.length, deleted, overLimit }),
    );
  }
}
```

- [ ] **Step 3: 真库 dry-run 验证（不删数据）**

Run: `DATABASE_URL="postgresql://mac@localhost:5432/jieniu" NODE_ENV=development npx tsx src/scripts/dedup-cross-source.ts --json > /tmp/dd.log 2>&1; echo "EXIT=$?"; tail -1 /tmp/dd.log`

Expected: EXIT=0，最后一行形如 `JSON_RESULT {"scanned":...,"redundant":N,"deleted":0,"overLimit":false}`，且 `deleted` **必须是 0**（没带 `--apply` 也没带 `--max-apply`）。

- [ ] **Step 4: 验证上限门确实会挡住**

Run: `DATABASE_URL="postgresql://mac@localhost:5432/jieniu" NODE_ENV=development npx tsx src/scripts/dedup-cross-source.ts --max-apply=0 --json > /tmp/dd2.log 2>&1; echo "EXIT=$?"; tail -1 /tmp/dd2.log`

Expected: EXIT=0。若当前库里 `redundant > 0`，则 `"overLimit":true,"deleted":0`；若 `redundant` 恰为 0，则 `"overLimit":false,"deleted":0`。两种情况 `deleted` 都是 0 —— **确认没有误删**。

- [ ] **Step 5: 提交**

```bash
git add src/scripts/dedup-cross-source.ts
git commit -m "feat(scripts): dedup-cross-source 加 --max-apply/--json，去掉两次扫描"
```

---

### Task 8: `runner.ts` —— spawn 单步（TDD）

**Files:**
- Create: `src/scheduler/fixtures/ok.ts`
- Create: `src/scheduler/fixtures/fail.ts`
- Create: `src/scheduler/fixtures/hang.ts`
- Create: `src/scheduler/runner.ts`
- Test: `src/scheduler/runner.test.ts`

- [ ] **Step 1: 造三个假脚本**

`src/scheduler/fixtures/ok.ts`：

```ts
// 单测夹具：正常退出并打一行 JSON_RESULT。
console.log("干活中…");
console.log("JSON_RESULT " + JSON.stringify({ n24: 312 }));
```

`src/scheduler/fixtures/fail.ts`：

```ts
// 单测夹具：往 stderr 写错因并以非 0 退出。
console.error("[fixture] 故意失败");
process.exitCode = 1;
```

`src/scheduler/fixtures/hang.ts`：

```ts
// 单测夹具：一直不退出，用来验证超时会被杀掉。
console.log("开始挂起");
setInterval(() => {
  /* 永不退出 */
}, 1000);
```

- [ ] **Step 2: 写失败的测试**

创建 `src/scheduler/runner.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { runStep } from "./runner";
import type { Step } from "./types";

const base = { cwd: process.cwd(), env: process.env };

describe("runStep", () => {
  it("正常退出：exitCode 0，输出收得到", async () => {
    const step: Step = { name: "ok", script: "src/scheduler/fixtures/ok.ts", args: [] };
    const r = await runStep(step, base);
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.output).toContain("JSON_RESULT");
  }, 60_000);

  it("非 0 退出：exitCode 与 stderr 都带回来", async () => {
    const step: Step = { name: "fail", script: "src/scheduler/fixtures/fail.ts", args: [] };
    const r = await runStep(step, base);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("故意失败");
  }, 60_000);

  it("超时：标 timedOut 并把进程杀掉", async () => {
    const step: Step = {
      name: "hang",
      script: "src/scheduler/fixtures/hang.ts",
      args: [],
      timeoutMs: 3_000,
    };
    const r = await runStep(step, base);
    expect(r.timedOut).toBe(true);
    expect(r.output).toContain("开始挂起");
  }, 60_000);

  it("缺密钥：不 spawn，直接标 skipped", async () => {
    const step: Step = {
      name: "needs-key",
      script: "src/scheduler/fixtures/ok.ts",
      args: [],
      requires: ["OPENROUTER_API_KEY"],
    };
    const r = await runStep(step, { cwd: process.cwd(), env: {} });
    expect(r.skipped).toBe("missing-secret");
    expect(r.output).toContain("OPENROUTER_API_KEY");
  }, 60_000);

  it("输出脱敏后才返回", async () => {
    const step: Step = { name: "ok", script: "src/scheduler/fixtures/ok.ts", args: [] };
    const r = await runStep(step, base);
    expect(r.output).not.toMatch(/[A-Za-z0-9._%+-]{2,}@/);
  }, 60_000);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/scheduler/runner.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT 非 0，`Failed to resolve import "./runner"`。

- [ ] **Step 4: 实现**

创建 `src/scheduler/runner.ts`：

```ts
// 单步执行：spawn 现有的 src/scripts/*.ts。
//
// 为什么 spawn 而不是 import 进来跑：那 46 个脚本每个都自带 `new PrismaClient()` 和
// 顶层 `main()`——import 会立刻执行并各开一个连接池。spawn 是零改动的精确复刻，
// 内存隔离；长回填被系统回收也只损失当前这片（脚本全幂等，下轮原样续）。

import { spawn } from "node:child_process";
import path from "node:path";
import { redact } from "./redact";
import type { Step } from "./types";

/** 输出只留尾部这么多字节——够看结论，又不会把库撑爆。 */
const OUTPUT_TAIL = 8 * 1024;
export const DEFAULT_TIMEOUT_MS = 45 * 60_000;
/** SIGTERM 之后再等这么久才 SIGKILL。 */
const KILL_GRACE_MS = 5_000;

export type StepResult = {
  name: string;
  exitCode: number | null;
  timedOut: boolean;
  /** 已脱敏的输出尾巴 */
  output: string;
  durationMs: number;
  skipped?: "missing-secret";
};

export type RunOpts = {
  cwd: string;
  env: Record<string, string | undefined>;
};

export async function runStep(step: Step, opts: RunOpts): Promise<StepResult> {
  const startedAt = Date.now();

  const missing = (step.requires ?? []).filter((k) => !opts.env[k]);
  if (missing.length > 0) {
    // 密钥缺失型故障是静默的（7-24 / 7-25 都栽在这）——绝不假装干过活。
    const msg =
      `[scheduler] 跳过「${step.name}」：缺密钥 ${missing.join(" / ")}。` +
      `生产必须用 scripts/start-scheduler.sh 启动（内含 secret exec 注入）。`;
    console.error(msg);
    return {
      name: step.name,
      exitCode: null,
      timedOut: false,
      output: msg,
      durationMs: Date.now() - startedAt,
      skipped: "missing-secret",
    };
  }

  const tsx = path.join(opts.cwd, "node_modules", ".bin", "tsx");
  const timeoutMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise<StepResult>((resolve) => {
    const child = spawn(tsx, [step.script, ...step.args], {
      cwd: opts.cwd,
      env: { ...opts.env, ...(step.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buf = "";
    let timedOut = false;
    let settled = false;

    const absorb = (chunk: Buffer) => {
      buf += chunk.toString();
      // 只留尾巴，边收边裁，长回填也不会把内存吃满。
      if (buf.length > OUTPUT_TAIL * 2) buf = buf.slice(-OUTPUT_TAIL);
    };
    child.stdout.on("data", absorb);
    child.stderr.on("data", absorb);

    let killTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }, timeoutMs);

    const done = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        name: step.name,
        exitCode,
        timedOut,
        output: redact(buf.slice(-OUTPUT_TAIL)),
        durationMs: Date.now() - startedAt,
      });
    };

    child.on("error", (e) => {
      console.error(`[scheduler] spawn「${step.name}」失败:`, e.message);
      buf += `\n[scheduler] spawn 失败: ${e.message}`;
      done(null);
    });
    child.on("close", (code) => done(code));
  });
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/scheduler/runner.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0，5 个测试全通过。超时那条大约耗时 3–8 秒。

- [ ] **Step 6: 提交**

```bash
git add src/scheduler/runner.ts src/scheduler/runner.test.ts src/scheduler/fixtures
git commit -m "feat(scheduler): 单步执行（spawn / 超时 / 缺密钥即跳过）"
```

---

### Task 9: `jobs.ts` —— 9 条任务声明

参数逐字照抄今天的 cron。`DATABASE_URL` 由 worker 进程统一提供，不再逐条写。

**Files:**
- Create: `src/scheduler/jobs.ts`
- Test: `src/scheduler/jobs.test.ts`

- [ ] **Step 1: 写声明自检的测试**

创建 `src/scheduler/jobs.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { JOBS } from "./jobs";

describe("JOBS 声明自检", () => {
  it("正好 9 条，key 唯一", () => {
    expect(JOBS).toHaveLength(9);
    expect(new Set(JOBS.map((j) => j.key)).size).toBe(9);
  });

  it("每一步引用的脚本文件都真实存在", () => {
    for (const j of JOBS) {
      for (const s of j.steps) {
        expect(existsSync(path.join(process.cwd(), s.script)), `${j.key}/${s.name}: ${s.script}`).toBe(true);
      }
    }
  });

  it("用 AI 的步骤都声明了 OPENROUTER_API_KEY", () => {
    for (const j of JOBS) {
      for (const s of j.steps) {
        if (s.env?.OPENROUTER_MODEL || /brief-recent|generate-market-digest/.test(s.script)) {
          expect(s.requires, `${j.key}/${s.name}`).toContain("OPENROUTER_API_KEY");
        }
      }
    }
  });

  it("发信的步骤都声明了阿里密钥", () => {
    const mailStep = JOBS.flatMap((j) => j.steps).find((s) => s.args.includes("--email"));
    expect(mailStep?.requires).toEqual(expect.arrayContaining(["ALI_KEY", "ALI_SECRET"]));
  });

  it("每条重活都标了 heavy", () => {
    const heavyKeys = JOBS.filter((j) => j.heavy).map((j) => j.key).sort();
    expect(heavyKeys).toEqual(
      [
        "backfill-announcements",
        "backfill-signals",
        "backfill-thesis",
        "backfill-year",
        "daily-digest",
        "daily-maintenance",
      ].sort(),
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/scheduler/jobs.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT 非 0，`Failed to resolve import "./jobs"`。

- [ ] **Step 3: 实现**

创建 `src/scheduler/jobs.ts`：

```ts
// 九条任务的唯一配置来源。参数逐字照抄 hermit-ui 上的 cron 命令行——这是「完全复刻」
// 的落点，改任何一个参数都等于改了线上行为。
//
// DATABASE_URL 由 worker 进程统一提供、子进程继承；下面各步只写额外的 env。
// 密钥同理：worker 由 scripts/start-scheduler.sh 的 secret exec 起，子进程继承，
// 所以原来每条命令里的 `secret exec` 全部不再需要。
//
// 日级任务的钟点是新锚定的（hermit-ui 只有 interval + jitter，实测「AI 早报」漂到了
// 17:31）。小时级/分钟级的仍是纯 interval，与今天一致。

import type { JobDef } from "./types";

const DEEPSEEK = { SKIP_ENV_VALIDATION: "1", OPENROUTER_MODEL: "deepseek/deepseek-chat" };

export const JOBS: JobDef[] = [
  {
    key: "ingest",
    title: "新闻定时抓取",
    schedule: { kind: "interval", everySec: 1800, jitterSec: 300 },
    heavy: false,
    steps: [
      {
        name: "ingest",
        script: "src/scripts/ingest.ts",
        args: [],
        env: { NODE_ENV: "development" },
      },
    ],
  },
  {
    key: "alert-generate",
    title: "提醒事件生成(Outbox)",
    schedule: { kind: "interval", everySec: 3600, jitterSec: 480 },
    heavy: false,
    steps: [
      {
        name: "generate",
        script: "src/scripts/alert-dispatch.ts",
        args: ["--generate"],
        env: { SKIP_ENV_VALIDATION: "1" },
      },
    ],
  },
  {
    key: "backfill-announcements",
    title: "公告回填(轮转)",
    schedule: { kind: "interval", everySec: 7200, jitterSec: 900 },
    heavy: true,
    steps: [
      {
        name: "backfill",
        script: "src/scripts/backfill-announcements.ts",
        args: ["--limit=40"],
        env: { SKIP_ENV_VALIDATION: "1", NODE_ENV: "development" },
      },
    ],
  },
  {
    key: "backfill-signals",
    title: "逻辑信号补齐（敏感度的原料）",
    schedule: { kind: "interval", everySec: 7200, jitterSec: 720 },
    heavy: true,
    steps: [
      {
        name: "signals",
        script: "src/scripts/backfill-signals.ts",
        args: ["--limit=150", "--concurrency=8"],
        env: DEEPSEEK,
        requires: ["OPENROUTER_API_KEY"],
        timeoutMs: 30 * 60_000,
      },
    ],
  },
  {
    key: "backfill-thesis",
    title: "热门股 thesis 补齐",
    schedule: { kind: "interval", everySec: 9000, jitterSec: 1200 },
    heavy: true,
    steps: [
      {
        name: "thesis",
        script: "src/scripts/backfill-thesis.ts",
        args: ["--limit=8"],
        env: DEEPSEEK,
        requires: ["OPENROUTER_API_KEY"],
      },
    ],
  },
  {
    key: "daily-maintenance",
    title: "日常维护 + 事件摘要 + 覆盖率巡检",
    schedule: { kind: "daily", atCST: "03:10", jitterSec: 900 },
    heavy: true,
    alwaysNarrate: true,
    steps: [
      {
        name: "实体维护",
        script: "src/scripts/fix-prefixed-names.ts",
        args: [],
        env: { NODE_ENV: "development" },
      },
      {
        name: "跨源去重",
        script: "src/scripts/dedup-cross-source.ts",
        // 上限 200 是照抄今天的口径：正常每日几十条，暴增时停手让人看。
        args: ["--max-apply=200", "--json"],
        env: { NODE_ENV: "development" },
        checks: [
          {
            id: "dedup-over-limit",
            metric: "overLimit",
            op: "eq",
            threshold: true,
            message: "跨源冗余数超过 200 条上限，本轮未删——需人工确认是不是判重逻辑出问题了",
          },
        ],
      },
      {
        name: "事件摘要",
        script: "src/scripts/brief-recent.ts",
        // 上限硬性 40 条/天，不要调高——候选池约 66 条/天，调高就是多花钱。
        args: ["--limit=40", "--hours=24"],
        env: DEEPSEEK,
        requires: ["OPENROUTER_API_KEY"],
      },
      {
        name: "覆盖率巡检",
        script: "src/scripts/coverage-report.ts",
        args: ["--json"],
        env: { NODE_ENV: "development" },
        // 前面出错也要巡检——今天 Claude 也是这么做的。
        runEvenIfPrevFailed: true,
        checks: [
          {
            id: "blank-companies",
            metric: "blankCompanies",
            op: "gt",
            threshold: 0,
            message: "存在完全空白的公司——实体维护那一步没修好",
          },
          {
            id: "news-7d",
            metric: "pctNews7d",
            op: "lt",
            threshold: 85,
            message: "近 7 天有资讯的公司占比跌破 85%——抓取变慢或源被封",
          },
          {
            id: "ingest-24h",
            metric: "n24",
            op: "eq",
            threshold: 0,
            message: "近 24 小时零新入库——ingest 挂了（最严重）",
          },
          {
            id: "hot-thesis",
            metric: "pctHotThesis",
            op: "lt",
            threshold: 100,
            message: "热门宇宙的 thesis 覆盖不足 100%",
          },
          {
            id: "stock-bound",
            metric: "pctStockBound",
            op: "lt",
            threshold: 99,
            message: "有绑定股票代码的公司不足 99%——又出孤儿公司",
          },
        ],
      },
      {
        name: "有效覆盖诊断",
        script: "src/scripts/effective-coverage.ts",
        args: [],
        env: { NODE_ENV: "development" },
        runEvenIfPrevFailed: true,
      },
    ],
  },
  {
    key: "backfill-year",
    title: "一年历史增量回填",
    schedule: { kind: "daily", atCST: "04:30", jitterSec: 900 },
    heavy: true,
    alwaysNarrate: true,
    steps: [
      {
        name: "公告",
        script: "src/scripts/backfill-year.ts",
        args: ["--months=12", "--limit=30", "--batch=10"],
        env: { NODE_ENV: "development" },
      },
      {
        name: "研报",
        script: "src/scripts/backfill-reports.ts",
        args: ["--months=12", "--limit=30", "--batch=10"],
        env: { NODE_ENV: "development" },
      },
      {
        name: "体检",
        script: "src/scripts/backfill-check.ts",
        args: ["--json"],
        env: { NODE_ENV: "development" },
        runEvenIfPrevFailed: true,
        checks: [
          {
            id: "dupe-groups",
            metric: "dupeGroups",
            op: "ne",
            threshold: 0,
            message: "体检查出重复组——去重失效",
          },
          {
            id: "report-rating-headline",
            metric: "reportRatingHeadlines",
            op: "ne",
            threshold: 0,
            message: "研报标题含评级/目标价——触碰研报合规铁律",
          },
          {
            id: "report-self-bound",
            metric: "reportSelfBound",
            op: "ne",
            threshold: 0,
            message: "研报绑到了发布机构自身——券商 feed 会被污染",
          },
        ],
      },
    ],
  },
  {
    key: "brief-morning",
    title: "AI 早报 brief 生成",
    schedule: { kind: "daily", atCST: "07:20", jitterSec: 600 },
    heavy: false,
    steps: [
      {
        name: "brief",
        script: "src/scripts/brief-recent.ts",
        args: ["--limit=60", "--hours=30"],
        env: DEEPSEEK,
        requires: ["OPENROUTER_API_KEY"],
      },
    ],
  },
  {
    key: "daily-digest",
    title: "每日复盘 + 推送（A股盘后）",
    schedule: { kind: "daily", atCST: "15:40", jitterSec: 300 },
    heavy: true,
    steps: [
      {
        name: "生成复盘",
        script: "src/scripts/generate-market-digest.ts",
        args: [],
        env: { SKIP_ENV_VALIDATION: "1" },
        requires: ["OPENROUTER_API_KEY"],
        timeoutMs: 60 * 60_000,
      },
      {
        name: "生成提醒并发信",
        script: "src/scripts/alert-dispatch.ts",
        args: ["--generate", "--email"],
        env: {
          SKIP_ENV_VALIDATION: "1",
          MAIL_FROM: "解牛 <noreply@mail.auramate.net>",
          ALI_REGION: "cn-hangzhou",
        },
        requires: ["ALI_KEY", "ALI_SECRET"],
      },
    ],
  },
];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/scheduler/jobs.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0，5 个测试全通过。

- [ ] **Step 5: 提交**

```bash
git add src/scheduler/jobs.ts src/scheduler/jobs.test.ts
git commit -m "feat(scheduler): 9 条任务声明（参数照抄 hermit-ui cron）"
```

---

### Task 10: `narrate.ts` —— OpenRouter 中文小结

**Files:**
- Create: `src/scheduler/narrate.ts`
- Test: `src/scheduler/narrate.test.ts`

- [ ] **Step 1: 写「什么时候该叫 AI」的测试**

创建 `src/scheduler/narrate.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { shouldNarrate, buildPrompt } from "./narrate";

describe("shouldNarrate", () => {
  it("稳态成功不叫 AI（ingest 一天 48 轮，别烧钱）", () => {
    expect(shouldNarrate({ status: "ok", alerts: [], alwaysNarrate: false })).toBe(false);
  });

  it("判据命中要叫", () => {
    expect(
      shouldNarrate({
        status: "ok",
        alerts: [{ id: "ingest-24h", message: "x", value: 0, threshold: 0 }],
        alwaysNarrate: false,
      }),
    ).toBe(true);
  });

  it("失败 / 超时 / 跳过都要叫", () => {
    for (const status of ["fail", "timeout", "skipped"] as const) {
      expect(shouldNarrate({ status, alerts: [], alwaysNarrate: false })).toBe(true);
    }
  });

  it("日级巡检全绿也要叫", () => {
    expect(shouldNarrate({ status: "ok", alerts: [], alwaysNarrate: true })).toBe(true);
  });
});

describe("buildPrompt", () => {
  it("巡检类小结带上环比数字", () => {
    const p = buildPrompt({
      title: "日常维护",
      status: "ok",
      alerts: [],
      metrics: { pctNews7d: 84.1 },
      prevMetrics: { pctNews7d: 85.2 },
      output: "报表若干",
    });
    expect(p.user).toContain("85.2");
    expect(p.user).toContain("84.1");
  });

  it("提示词写明 AI 不负责判定成败", () => {
    const p = buildPrompt({
      title: "日常维护",
      status: "fail",
      alerts: [],
      metrics: null,
      prevMetrics: null,
      output: "boom",
    });
    expect(p.system).toContain("不要改判");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/scheduler/narrate.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT 非 0，`Failed to resolve import "./narrate"`。

- [ ] **Step 3: 实现**

创建 `src/scheduler/narrate.ts`：

```ts
// 中文小结 —— 今天由 Claude 交互回合承担的那部分判断，改由 OpenRouter 承担。
//
// 复用 src/server/llm.ts：那份客户端就是为 tsx 场景写的（直读 process.env，不走 ~/env）。
// 模型固定 deepseek（anthropic / openai 在大陆 403）。
//
// 四条护栏：
//   ① AI 只解释、不裁决 —— status 与 alerts 全部由代码判定，喂给它的是已经判好的结论。
//   ② 必须喂环比 —— 「AI 写的都是正确的废话」根因在喂进去的数据，不在提示词。
//      巡检类小结取不到上一轮数字就不叫 AI，直接机械输出。
//   ③ AI 挂了不动任务状态 —— 单独 try/catch，失败退回机械摘要。绝不裸 catch。
//   ④ 喂进去的输出已在 runner 里脱敏。

import { llmChat } from "../server/llm";
import type { Alert, JobStatus, Metrics } from "./types";

export type NarrateInput = {
  title: string;
  status: JobStatus;
  alerts: Alert[];
  metrics: Metrics | null;
  prevMetrics: Metrics | null;
  /** 已脱敏的输出尾巴 */
  output: string;
};

export function shouldNarrate(x: {
  status: JobStatus;
  alerts: Alert[];
  alwaysNarrate: boolean;
}): boolean {
  if (x.status !== "ok" && x.status !== "running") return true;
  if (x.alerts.length > 0) return true;
  return x.alwaysNarrate;
}

const SYSTEM = [
  "你是解牛的运维助手。用户给你一次定时任务运行的**已判定结果**和原始输出，你只负责用中文解释。",
  "硬性要求：",
  "1. 成败已由代码判定，**不要改判**，也不要说「建议重跑看看是否正常」这类空话。",
  "2. 只讲输出里有据可查的事实；没有依据就说「输出里看不出原因」，不要编。",
  "3. 有环比数字时必须点出变化幅度；没有变化就直说稳定。",
  "4. 有异常时给出：哪一项、数字怎么变的、最可能的原因、建议的动作。",
  "5. 控制在 120 字以内，不要分点罗列，不要复述原始输出。",
].join("\n");

export function buildPrompt(input: NarrateInput): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`任务：${input.title}`);
  lines.push(`代码判定的状态：${input.status}`);

  if (input.alerts.length > 0) {
    lines.push("命中的判据：");
    for (const a of input.alerts) {
      lines.push(`  · ${a.message}（实际 ${String(a.value)}，阈值 ${String(a.threshold)}）`);
    }
  } else {
    lines.push("命中的判据：无");
  }

  if (input.metrics) {
    lines.push("本轮指标：");
    for (const [k, v] of Object.entries(input.metrics)) {
      const prev = input.prevMetrics?.[k];
      lines.push(
        prev === undefined
          ? `  · ${k} = ${String(v)}`
          : `  · ${k}: ${String(prev)} → ${String(v)}`,
      );
    }
  }

  lines.push("原始输出（尾部，已脱敏）：");
  lines.push(input.output.slice(-3000));

  return { system: SYSTEM, user: lines.join("\n") };
}

/**
 * 返回 null 表示「这轮不该叫 AI」或「叫了但失败」——调用方退回机械摘要。
 * 绝不因为 AI 失败而改变任务状态。
 */
export async function narrate(
  input: NarrateInput,
  opts: { alwaysNarrate: boolean },
): Promise<string | null> {
  if (!shouldNarrate({ status: input.status, alerts: input.alerts, alwaysNarrate: opts.alwaysNarrate })) {
    return null;
  }
  // 护栏②：巡检类小结（状态 ok、只是例行出报告）没有环比就没料可写，别叫 AI。
  if (input.status === "ok" && input.alerts.length === 0 && !input.prevMetrics) {
    console.log("[scheduler] 取不到上一轮指标，跳过 AI 小结（没有环比就没有增量信息）");
    return null;
  }
  const { system, user } = buildPrompt(input);
  try {
    return await llmChat(system, user, { maxTokens: 400, temperature: 0.3 });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[scheduler] AI 小结失败:", reason);
    return `[AI 小结未生成] ${reason}`;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/scheduler/narrate.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0，6 个测试全通过。

- [ ] **Step 5: 提交**

```bash
git add src/scheduler/narrate.ts src/scheduler/narrate.test.ts
git commit -m "feat(scheduler): OpenRouter 中文小结（AI 只解释不裁决）"
```

---

### Task 11: `notify.ts` —— 告警邮件 + 节流

**Files:**
- Create: `src/scheduler/notify.ts`
- Test: `src/scheduler/notify.test.ts`

- [ ] **Step 1: 写节流判定的测试**

创建 `src/scheduler/notify.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { shouldNotify, THROTTLE_MS } from "./notify";

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 29, 12, 0, 0);

describe("shouldNotify", () => {
  it("稳态成功不发信", () => {
    expect(shouldNotify({ status: "ok", alertCount: 0, lastNotifiedAtMs: null, nowMs: now })).toBe(false);
  });

  it("失败要发", () => {
    expect(shouldNotify({ status: "fail", alertCount: 0, lastNotifiedAtMs: null, nowMs: now })).toBe(true);
  });

  it("判据命中要发", () => {
    expect(shouldNotify({ status: "ok", alertCount: 2, lastNotifiedAtMs: null, nowMs: now })).toBe(true);
  });

  it("6 小时内已发过就不再发（同一个故障别刷屏）", () => {
    expect(
      shouldNotify({ status: "fail", alertCount: 0, lastNotifiedAtMs: now - HOUR, nowMs: now }),
    ).toBe(false);
  });

  it("超过 6 小时可以再发", () => {
    expect(
      shouldNotify({
        status: "fail",
        alertCount: 0,
        lastNotifiedAtMs: now - THROTTLE_MS - 1000,
        nowMs: now,
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/scheduler/notify.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT 非 0，`Failed to resolve import "./notify"`。

- [ ] **Step 3: 实现**

创建 `src/scheduler/notify.ts`：

```ts
// 告警投递。稳态静默——只在任务 fail / timeout / skipped，或任一判据命中时发。
//
// 自带阿里 DirectMail 客户端（~25 行），不去改 src/server/alert-mailer.ts：
// 那是别的 session 也在动的共享文件，新逻辑一律开新文件。

import Core from "@alicloud/pop-core";
import type { Alert, JobStatus } from "./types";

/** 同一条任务两封告警信之间至少隔这么久，免得一个故障半夜刷屏。 */
export const THROTTLE_MS = 6 * 60 * 60 * 1000;

export function shouldNotify(x: {
  status: JobStatus;
  alertCount: number;
  lastNotifiedAtMs: number | null;
  nowMs: number;
}): boolean {
  const worth = x.status === "fail" || x.status === "timeout" || x.status === "skipped" || x.alertCount > 0;
  if (!worth) return false;
  if (x.lastNotifiedAtMs === null) return true;
  return x.nowMs - x.lastNotifiedAtMs >= THROTTLE_MS;
}

function mailFrom(): string {
  return process.env.MAIL_FROM ?? "解牛 <noreply@mail.auramate.net>";
}
function senderAddress(): string {
  const f = mailFrom();
  return (/<([^>]+)>/.exec(f)?.[1] ?? f).trim();
}
function fromAlias(): string {
  return /^\s*([^<]+?)\s*</.exec(mailFrom())?.[1]?.trim() ?? "解牛";
}

let client: Core | null = null;
function getClient(): Core | null {
  const key = process.env.ALI_KEY;
  const secret = process.env.ALI_SECRET;
  if (!key || !secret) return null;
  const region = process.env.ALI_REGION ?? "cn-hangzhou";
  client ??= new Core({
    accessKeyId: key,
    accessKeySecret: secret,
    endpoint:
      region === "ap-southeast-1"
        ? "https://dm.ap-southeast-1.aliyuncs.com"
        : "https://dm.aliyuncs.com",
    apiVersion: "2015-11-23",
  });
  return client;
}

export type NotifyPayload = {
  jobKey: string;
  title: string;
  status: JobStatus;
  alerts: Alert[];
  narration: string | null;
  /** 已脱敏 */
  output: string;
  durationMs: number;
};

function renderHtml(p: NotifyPayload): string {
  const alertRows = p.alerts
    .map(
      (a) =>
        `<li><b>${a.id}</b>：${a.message}（实际 ${String(a.value)}，阈值 ${String(a.threshold)}）</li>`,
    )
    .join("");
  return [
    `<h2>解牛定时任务告警：${p.title}</h2>`,
    `<p>状态 <b>${p.status}</b>｜耗时 ${Math.round(p.durationMs / 1000)}s｜key <code>${p.jobKey}</code></p>`,
    p.narration ? `<p>${p.narration}</p>` : "",
    alertRows ? `<h3>命中的判据</h3><ul>${alertRows}</ul>` : "",
    `<h3>输出尾部</h3><pre style="white-space:pre-wrap;font-size:12px">${p.output.slice(-4000)}</pre>`,
  ].join("\n");
}

/** 返回是否真的发出去了。任何失败都只打日志，绝不影响任务状态。 */
export async function sendAlertMail(p: NotifyPayload): Promise<boolean> {
  const to = process.env.OPS_ALERT_EMAIL;
  if (!to) {
    console.error("[scheduler] 未设 OPS_ALERT_EMAIL —— 告警只落库，不发信");
    return false;
  }
  const c = getClient();
  if (!c) {
    console.error("[scheduler] 缺 ALI_KEY / ALI_SECRET —— 告警只落库，不发信");
    return false;
  }
  try {
    await c.request(
      "SingleSendMail",
      {
        RegionId: process.env.ALI_REGION ?? "cn-hangzhou",
        AccountName: senderAddress(),
        AddressType: 1,
        ReplyToAddress: false,
        ToAddress: to,
        Subject: `[解牛] ${p.title} ${p.status}${p.alerts.length ? ` · ${p.alerts.length} 项判据命中` : ""}`,
        FromAlias: fromAlias(),
        HtmlBody: renderHtml(p),
      },
      { method: "POST" },
    );
    return true;
  } catch (e) {
    console.error("[scheduler] 告警信发送失败:", e instanceof Error ? e.message : e);
    return false;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/scheduler/notify.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0，5 个测试全通过。

- [ ] **Step 5: 提交**

```bash
git add src/scheduler/notify.ts src/scheduler/notify.test.ts
git commit -m "feat(scheduler): 告警邮件 + 每任务 6 小时节流"
```

---

### Task 12: `main.ts` —— worker 主循环

**Files:**
- Create: `src/scheduler/main.ts`
- Modify: `package.json`（加 `scheduler` script、`tsx` 移到 dependencies）

- [ ] **Step 1: 实现主循环**

创建 `src/scheduler/main.ts`：

```ts
// 服务内调度器的 worker 进程。pm2 托管，scripts/start-scheduler.sh 是唯一启动入口。
//
// 每 30 秒 tick 一次：找到期任务 → 串行跑各步 → 判据求值 → AI 小结 → 落 JobRun → 算下次触发。
//
// 相对导入 + 自建 PrismaClient：~ 别名在 tsx 下不解析，且 src/server/db.ts import 了 ~/env。

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../../generated/prisma";
import { JOBS } from "./jobs";
import { nextFireAfter } from "./schedule";
import { runStep, DEFAULT_TIMEOUT_MS } from "./runner";
import { parseJsonResult, evalChecks } from "./checks";
import { narrate } from "./narrate";
import { sendAlertMail, shouldNotify } from "./notify";
import type { Alert, JobDef, JobStatus, Metrics } from "./types";

const db = new PrismaClient();
const TICK_MS = 30_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** heavy 任务连续被互斥挡下这么多次就记一条 skipped 并告警，防止饿死。 */
const MAX_BLOCKED = 3;

const blockedCount = new Map<string, number>();
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

/** 把 JOBS 里新增的任务补进 JobState；已存在的不动（保留 enabled / nextFire）。 */
async function ensureStates(): Promise<void> {
  for (const j of JOBS) {
    await db.jobState.upsert({
      where: { key: j.key },
      create: { key: j.key },
      update: {},
    });
  }
}

function jobTimeoutMs(job: JobDef): number {
  return job.steps.reduce((sum, s) => sum + (s.timeoutMs ?? DEFAULT_TIMEOUT_MS), 0);
}

async function prevMetricsOf(jobKey: string): Promise<Metrics | null> {
  const prev = await db.jobRun.findFirst({
    where: { jobKey, status: { in: ["ok", "fail", "timeout"] }, metrics: { not: null } },
    orderBy: { firedAt: "desc" },
  });
  return (prev?.metrics as Metrics | null) ?? null;
}

async function fire(job: JobDef): Promise<void> {
  running.add(job.key);
  const startedAt = Date.now();
  const prevMetrics = await prevMetricsOf(job.key);

  await db.jobState.update({
    where: { key: job.key },
    data: { runningAt: new Date(startedAt), lastFire: new Date(startedAt), lastStatus: "running" },
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
  let allSkipped = true;

  try {
    for (const step of job.steps) {
      if (prevFailed && !step.runEvenIfPrevFailed) {
        chunks.push(`── ${step.name}：前一步失败，跳过 ──`);
        continue;
      }
      const r = await runStep(step, { cwd: ROOT, env: process.env });
      chunks.push(`── ${step.name}（${Math.round(r.durationMs / 1000)}s）──\n${r.output}`);

      if (r.skipped === "missing-secret") {
        prevFailed = true;
        if (status === "ok") status = "skipped";
        continue;
      }
      anyRan = true;
      allSkipped = false;

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
    if (!anyRan && allSkipped) status = "skipped";
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
      nextFire: new Date(nextFireAfter(job.schedule, Date.now())),
    },
  });

  running.delete(job.key);
  console.log(
    `[scheduler] done ${job.key} ${status} ${durationMs}ms${alerts.length ? ` · ${alerts.length} 项判据命中` : ""}`,
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
    if (!st || !st.enabled) continue;
    if (running.has(job.key)) continue;

    // 死锁自愈：进程被 kill -9 会留下 runningAt。超过该任务总 timeout 两倍即释放。
    if (st.runningAt) {
      const stuckFor = now - st.runningAt.getTime();
      if (stuckFor < jobTimeoutMs(job) * 2) continue;
      console.error(
        `[scheduler] ${job.key} 的 runningAt 卡了 ${Math.round(stuckFor / 60_000)} 分钟，判定死锁并释放`,
      );
      await db.jobState.update({ where: { key: job.key }, data: { runningAt: null } });
    }

    // nextFire 为空 = 从未跑过 ⇒ 立即到期。已过期的补跑一次，不补齐错过的所有轮次。
    if (st.nextFire && st.nextFire.getTime() > now) continue;

    if (job.heavy && heavyBusy()) {
      const n = (blockedCount.get(job.key) ?? 0) + 1;
      blockedCount.set(job.key, n);
      if (n >= MAX_BLOCKED) {
        blockedCount.set(job.key, 0);
        console.error(`[scheduler] ${job.key} 连续 ${n} 次被 heavy 互斥挡下`);
        await db.jobRun.create({
          data: {
            jobKey: job.key,
            status: "skipped",
            finishedAt: new Date(),
            output: `连续 ${n} 次被 heavy 互斥挡下——检查是不是某条重活跑太久了`,
            durationMs: 0,
          },
        });
      }
      continue;
    }

    blockedCount.set(job.key, 0);
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
  console.log(`[scheduler] 已加载 ${JOBS.length} 条任务，每 ${TICK_MS / 1000}s 巡检一次`);
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
```

- [ ] **Step 2: 改 `package.json`**

- 把 `"tsx": "^…"` 从 `devDependencies` 剪到 `dependencies`（版本号原样保留）。生产 worker 和所有任务都靠它，留在 devDeps 意味着哪天 `npm ci --omit=dev` 就整条管线没了。
- 在 `scripts` 里加一行：`"scheduler": "tsx src/scheduler/main.ts",`

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/tsc.log`
Expected: EXIT=0，无输出。

- [ ] **Step 4: 冒烟——让 worker 起来跑一个 tick 就停**

先把所有任务禁用，避免冒烟时真跑起 9 条管线：

Run:
```
DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx -e '
import { PrismaClient } from "./generated/prisma";
void (async () => {
  const db = new PrismaClient();
  await db.jobState.updateMany({ data: { enabled: false } });
  console.log("已全部禁用:", await db.jobState.count({ where: { enabled: false } }));
  await db.$disconnect();
})();
' > /tmp/dis.log 2>&1; echo "EXIT=$?"; cat /tmp/dis.log
```
Expected: EXIT=0。首次运行时表是空的、输出 `已全部禁用: 0`，正常——下一步 worker 起来会 upsert 出 9 行，届时再跑一次这条命令禁用。

Run:
```
DATABASE_URL="postgresql://mac@localhost:5432/jieniu" timeout 40 npx tsx src/scheduler/main.ts > /tmp/sched.log 2>&1; echo "EXIT=$?"; cat /tmp/sched.log
```
Expected: 日志里有 `[scheduler] ✗ 缺少密钥 …`（本地没注入，正常）和 `[scheduler] 已加载 9 条任务`，**没有** `fire` 行（任务已禁用）。`timeout` 会让退出码是 124，这是预期的。

再跑一次上面的禁用命令，确认输出 `已全部禁用: 9`。

- [ ] **Step 5: 提交**

```bash
git add src/scheduler/main.ts package.json
git commit -m "feat(scheduler): worker 主循环（tick / 锁 / heavy 互斥 / 落库）"
```

---

### Task 13: `/admin/jobs` 只读运行记录页

**Files:**
- Create: `src/app/admin/jobs/page.tsx`

- [ ] **Step 1: 实现页面**

创建 `src/app/admin/jobs/page.tsx`：

```tsx
// 定时任务运行记录（只读）。
//
// 现在**不设防**——sway 的决定是「先直接挂着，后续增加超管」。所以：
//   · 只读，不放任何触发 / 禁用按钮（公网可达的页面上放能改数据的按钮，风险不对等）
//   · robots noindex
//   · output 已在 runner 里脱敏（stdout 里有真实用户邮箱）
// 超管落地前，不要在本页加任何写操作。

import { db } from "~/server/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "定时任务", robots: { index: false, follow: false } };

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  fail: "bg-red-100 text-red-800",
  timeout: "bg-amber-100 text-amber-800",
  skipped: "bg-neutral-200 text-neutral-700",
  running: "bg-blue-100 text-blue-800",
};

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

export default async function AdminJobsPage() {
  const [states, runs] = await Promise.all([
    db.jobState.findMany({ orderBy: { key: "asc" } }),
    db.jobRun.findMany({ orderBy: { firedAt: "desc" }, take: 200 }),
  ]);

  const byKey = new Map<string, typeof runs>();
  for (const r of runs) {
    const list = byKey.get(r.jobKey) ?? [];
    if (list.length < 20) list.push(r);
    byKey.set(r.jobKey, list);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-xl font-semibold">定时任务</h1>
      <p className="mt-1 text-sm text-neutral-500">
        服务内调度器（jieniu-scheduler）。只读——启停请用 `scripts/start-scheduler.sh`。
      </p>

      <div className="mt-6 space-y-4">
        {states.map((s) => {
          const list = byKey.get(s.key) ?? [];
          const last = list[0];
          return (
            <section key={s.key} className="rounded-lg border border-neutral-200 p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <code className="text-sm font-semibold">{s.key}</code>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[s.lastStatus ?? ""] ?? "bg-neutral-100 text-neutral-600"}`}
                >
                  {s.lastStatus ?? "从未运行"}
                </span>
                {!s.enabled && (
                  <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs">已禁用</span>
                )}
                <span className="text-xs text-neutral-500">
                  上次 {fmt(s.lastFire)}｜下次 {fmt(s.nextFire)}
                  {last?.durationMs != null && `｜耗时 ${Math.round(last.durationMs / 1000)}s`}
                </span>
              </div>

              <div className="mt-2 flex gap-1">
                {list
                  .slice()
                  .reverse()
                  .map((r) => (
                    <span
                      key={r.id}
                      title={`${fmt(r.firedAt)} ${r.status}`}
                      className={`h-3 w-3 rounded-sm ${STATUS_STYLE[r.status]?.split(" ")[0] ?? "bg-neutral-200"}`}
                    />
                  ))}
              </div>

              {last?.narration && (
                <p className="mt-3 text-sm text-neutral-700">{last.narration}</p>
              )}

              {Array.isArray(last?.alerts) && last.alerts.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
                  {(last.alerts as { id: string; message: string }[]).map((a) => (
                    <li key={a.id}>{a.message}</li>
                  ))}
                </ul>
              )}

              {last?.output && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-neutral-500">输出尾部</summary>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-xs">
                    {last.output}
                  </pre>
                </details>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: 类型 + lint 检查（不跑 build）**

Run: `npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC_EXIT=$?"`
Expected: TSC_EXIT=0。

Run: `npx next lint > /tmp/lint.log 2>&1; echo "LINT_EXIT=$?"; cat /tmp/lint.log`
Expected: LINT_EXIT=0。**必须看完整 log，不能 `| tail`**——管道后的 `$?` 是 `tail` 的退出码，这个坑踩过。

- [ ] **Step 3: 提交**

```bash
git add src/app/admin/jobs/page.tsx
git commit -m "feat(admin): 定时任务运行记录页（只读 + noindex）"
```

---

### Task 14: `scripts/start-scheduler.sh` + pm2

**Files:**
- Create: `scripts/start-scheduler.sh`

- [ ] **Step 1: 写启动脚本**

创建 `scripts/start-scheduler.sh`：

```bash
#!/usr/bin/env bash
#
# 服务内调度器的唯一启动入口。
#
# 为什么必须走这个脚本：OPENROUTER_API_KEY / ALI_KEY / ALI_SECRET 只在 secret store，
# 不在 .env。裸起 worker 能起来、日志也不报错，但所有 AI 任务会被标 skipped、
# 告警信发不出去。把 secret exec 写进命令结构里，比写进文档里可靠。
#
# 为什么每次都 delete 再 start：pm2 只在 `start` 时从客户端捕获环境变量，
# `pm2 restart` **不会**重新读 env（除非 --update-env，而那时也要在 secret exec 下跑）。
# 直接 delete + start 是唯一不会悄悄丢密钥的做法。
#
# 用法：
#   scripts/start-scheduler.sh
#   OPS_ALERT_EMAIL=you@example.com scripts/start-scheduler.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NAME="${NAME:-jieniu-scheduler}"
LOG="${LOG:-/Users/mac/jieniu-scheduler.log}"
DB="${DATABASE_URL:-postgresql://mac@localhost:5432/jieniu}"

command -v secret >/dev/null 2>&1 || {
  echo "✗ 找不到 secret CLI —— 没它就注入不了密钥，拒绝启动"
  exit 1
}
command -v pm2 >/dev/null 2>&1 || {
  echo "✗ 找不到 pm2 —— 拒绝启动"
  exit 1
}

echo "→ 移除旧进程（保证密钥重新注入）"
pm2 delete "$NAME" >/dev/null 2>&1 || true

echo "→ 启动（secret exec 注入 OPENROUTER_API_KEY / ALI_KEY / ALI_SECRET）"
secret exec OPENROUTER_API_KEY ALI_KEY ALI_SECRET -- \
  env DATABASE_URL="$DB" \
      MAIL_FROM="解牛 <noreply@mail.auramate.net>" \
      ALI_REGION=cn-hangzhou \
      OPS_ALERT_EMAIL="${OPS_ALERT_EMAIL:-}" \
  pm2 start node_modules/.bin/tsx \
      --name "$NAME" \
      --output "$LOG" --error "$LOG" \
      --time \
      -- src/scheduler/main.ts

echo "→ 等待启动自检"
sleep 6

boot=$(grep -m1 '\[scheduler\] [✓✗] 密钥' "$LOG" | tail -1 || true)
if [ -z "$boot" ]; then
  echo "  ⚠ 日志里没有 [scheduler] 密钥自检行，看 $LOG"
  pm2 logs "$NAME" --lines 30 --nostream || true
  exit 1
elif printf '%s' "$boot" | grep -q '✗'; then
  echo "✗ $boot"
  exit 1
else
  echo "  $boot"
fi

grep -m1 '已加载 .* 条任务' "$LOG" || {
  echo "✗ 没看到「已加载 N 条任务」，worker 可能没进主循环"
  exit 1
}

pm2 save >/dev/null 2>&1 || true
echo "✓ 已启动 $NAME，日志 $LOG"
```

- [ ] **Step 2: 加执行权限并启动**

Run: `chmod +x scripts/start-scheduler.sh && OPS_ALERT_EMAIL="$(git config user.email)" scripts/start-scheduler.sh > /tmp/start.log 2>&1; echo "EXIT=$?"; cat /tmp/start.log`

Expected: EXIT=0，输出里有 `[scheduler] ✓ 密钥齐全` 和 `已加载 9 条任务`，最后 `✓ 已启动 jieniu-scheduler`。

> `OPS_ALERT_EMAIL` 的真实取值问 sway；这里先用 git 配置的邮箱占位，切换前必须换成 sway 要收信的地址。

- [ ] **Step 3: 确认所有任务仍是禁用状态**

Run:
```
DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx -e '
import { PrismaClient } from "./generated/prisma";
void (async () => {
  const db = new PrismaClient();
  console.table(await db.jobState.findMany({ select: { key: true, enabled: true, nextFire: true } }));
  await db.$disconnect();
})();
' > /tmp/states.log 2>&1; echo "EXIT=$?"; cat /tmp/states.log
```
Expected: EXIT=0，9 行，`enabled` 全部为 `false`。**Task 17 之前一条都不许开。**

- [ ] **Step 4: 提交**

```bash
git add scripts/start-scheduler.sh
git commit -m "feat(scheduler): start-scheduler.sh（secret exec + pm2 + 启动自检）"
```

---

### Task 15: 端到端验收（真跑一条任务）

在切换之前，用**副作用最小**的那条任务证明整条链路通。

**Files:** 无改动

- [ ] **Step 1: 单开 `ingest`，看它真跑一轮**

Run:
```
DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx -e '
import { PrismaClient } from "./generated/prisma";
void (async () => {
  const db = new PrismaClient();
  await db.jobState.update({ where: { key: "ingest" }, data: { enabled: true, nextFire: null } });
  console.log("ingest 已启用，nextFire 清空（立即到期）");
  await db.$disconnect();
})();
' > /tmp/en.log 2>&1; echo "EXIT=$?"; cat /tmp/en.log
```
Expected: EXIT=0。

等 60 秒后：

Run: `grep -E "fire ingest|done ingest" /Users/mac/jieniu-scheduler.log | tail -5`
Expected: 看到 `[scheduler] fire ingest`，随后 `[scheduler] done ingest ok <耗时>ms`。

- [ ] **Step 2: 确认落库了**

Run:
```
DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx -e '
import { PrismaClient } from "./generated/prisma";
void (async () => {
  const db = new PrismaClient();
  const r = await db.jobRun.findFirst({ where: { jobKey: "ingest" }, orderBy: { firedAt: "desc" } });
  console.log({ status: r?.status, exitCode: r?.exitCode, durationMs: r?.durationMs, hasOutput: !!r?.output, narration: r?.narration });
  console.log("输出尾巴里有没有邮箱:", /[A-Za-z0-9._%+-]{2,}@/.test(r?.output ?? "") ? "有——脱敏漏了！" : "无 ✓");
  await db.$disconnect();
})();
' > /tmp/run.log 2>&1; echo "EXIT=$?"; cat /tmp/run.log
```
Expected: EXIT=0，`status: "ok"`、`hasOutput: true`、`narration: null`（稳态成功不叫 AI）、脱敏检查输出「无 ✓」。

- [ ] **Step 3: 验判据 + AI 小结确实有鉴别力**

不动生产数据，用假指标直接验 `evalChecks` + `narrate` 的组合：

Run:
```
OPENROUTER_MODEL=deepseek/deepseek-chat secret exec OPENROUTER_API_KEY -- npx tsx -e '
import { evalChecks } from "./src/scheduler/checks";
import { narrate } from "./src/scheduler/narrate";
import { JOBS } from "./src/scheduler/jobs";
void (async () => {
  const step = JOBS.find(j => j.key === "daily-maintenance").steps.find(s => s.name === "覆盖率巡检");
  const green = { blankCompanies: 0, pctNews7d: 91.2, n24: 312, pctHotThesis: 100, pctStockBound: 99.6 };
  const red   = { ...green, n24: 0 };
  console.log("全绿命中数:", evalChecks(step.checks, green).length);
  const alerts = evalChecks(step.checks, red);
  console.log("入库=0 命中数:", alerts.length, alerts.map(a => a.id));
  const text = await narrate({ title: "日常维护", status: "ok", alerts, metrics: red, prevMetrics: green, output: "（冒烟）" }, { alwaysNarrate: true });
  console.log("AI 小结:", text);
})();
' > /tmp/judge.log 2>&1; echo "EXIT=$?"; cat /tmp/judge.log
```

Expected: EXIT=0；`全绿命中数: 0`；`入库=0 命中数: 1 [ 'ingest-24h' ]`；AI 小结是一段中文，**必须点到「近 24 小时零新入库」这件事**。若它写的是"数据正常，继续观察"这类空话，说明喂进去的料不够——回头看 `buildPrompt`，别去松提示词。

- [ ] **Step 4: 把 `ingest` 关回去**

Run:
```
DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx -e '
import { PrismaClient } from "./generated/prisma";
void (async () => {
  const db = new PrismaClient();
  await db.jobState.update({ where: { key: "ingest" }, data: { enabled: false } });
  console.log("已关闭 ingest；仍启用的任务数:", await db.jobState.count({ where: { enabled: true } }));
  await db.$disconnect();
})();
' > /tmp/off.log 2>&1; echo "EXIT=$?"; cat /tmp/off.log
```
Expected: EXIT=0，`仍启用的任务数: 0`。

- [ ] **Step 5: 跑全量测试**

Run: `npx vitest run > /tmp/all.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/all.log`
Expected: EXIT=0，全绿（原有 700+ 条 + 本次新增的约 33 条）。

---

### Task 16: 文档 + 铁律改写

**Files:**
- Modify: `docs/reference/deploy.md`
- Modify: `../../AGENTS.md`（即 `/Users/mac/claudeclaw/finance-agent/AGENTS.md`）

- [ ] **Step 1: 在 `docs/reference/deploy.md` 末尾追加一节**

```markdown
## 定时任务（服务内调度器）

9 条数据管线由 `jieniu-scheduler`（pm2）派发，不再依赖 hermit-ui。任务声明在
`src/scheduler/jobs.ts`，运行记录看 `/admin/jobs`。

**启停**

- 启动 / 重启：`scripts/start-scheduler.sh` —— **唯一入口**。
  它 `pm2 delete` 再 `pm2 start`，因为 `pm2 restart` 不会重新读环境变量，
  直接 restart 会静默丢掉 `secret exec` 注入的三个密钥（AI 任务全部 skipped、告警信发不出）。
- 状态：`pm2 list` / `pm2 logs jieniu-scheduler --lines 50`
- 日志：`/Users/mac/jieniu-scheduler.log`

**改了代码之后**

worker 与 web 是两个进程。改了 `src/server/*` 或 `src/scripts/*` 之后，
**两个都要重启**：`NODE_ENV=production npm run build`（exit 0 之后才继续）→
`scripts/start-prod.sh` → `scripts/start-scheduler.sh`。
只重启一个会让两边跑不同版本的共享代码。

**临时禁用某条任务**

改 `JobState.enabled`（`/admin/jobs` 是只读的，超管落地前不提供按钮）：

    DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx -e '
    import { PrismaClient } from "./generated/prisma";
    void (async () => {
      const db = new PrismaClient();
      await db.jobState.update({ where: { key: "<key>" }, data: { enabled: false } });
      await db.$disconnect();
    })();
    '

（`tsx -e` 的 eval 走 cjs，**不支持顶层 await**，所以要包成 async IIFE。）

**排查**

- 任务没跑：先看 `JobState.nextFire` 和 `enabled`，再看 `runningAt` 是不是卡住了
  （超过该任务总 timeout 两倍会自动释放）。
- 任务标 `skipped`：多半是缺密钥——`grep '\[scheduler\]' /Users/mac/jieniu-scheduler.log` 看自检行。
- AI 小结写的是废话：看喂进去的料够不够（`JobRun.metrics` 有没有环比），别去松提示词。
```

- [ ] **Step 2: 改 `AGENTS.md` 的铁律**

把 `## Cron / Scheduled Tasks — HARD RULE` 那一节的第一段改成分治表述：

```markdown
## Cron / Scheduled Tasks — HARD RULE

**先分清是哪一类任务：**

- **Agent 级任务**（心跳、巡检提醒、要一个 Claude 回合去做判断的活）——**必须**走 `cron` skill，
  它注册进 hermit-ui 的 `/cron` 页，由 gateway 的 cron-runner 起一个新的交互回合。
  在会话内循环用 `loop` skill。
- **应用级数据管线**（解牛的 ingest / 回填 / 复盘 / 巡检这 9 条）——走**服务内调度器**
  （`projects/jieniu/src/scheduler/`，pm2 托管，见 `projects/jieniu/docs/reference/deploy.md`）。
  这类活不需要 Claude 在回路里，把它们放进 hermit-ui 等于让解牛的存活性挂在另一个产品上。

两类都**绝不**手搓 OS 调度器：没有 LaunchAgents、没有 launchd `.plist`、没有 systemd-user timer、
没有系统 `crontab`。那些对 dashboard 不可见、绕开配额路由，是 hermit-ui 之前的老模型。
```

其余各条（"严格照 prompt 执行"、"每轮自测"）保持不变。

- [ ] **Step 3: 提交**

```bash
git add docs/reference/deploy.md
git commit -m "docs: 补服务内调度器的启停与排查"
```

`AGENTS.md` 在 agent 根目录、不在 jieniu 仓库里，单独告知 sway 即可，无需提交。

---

### Task 17: 分批切换

**不双跑**——重复烧 AI，且 `daily-digest` 有重复发信风险。每条都是两步原子操作：hermit-ui 上**禁用（不删）** → worker 上启用。

**Files:** 无代码改动

- [ ] **Step 1: 第一批（脚本层无 AI、无外部投递）**

在 hermit-ui `/cron` 页上把这三条**禁用**（不要删）：`解牛 ingest 抓取`、`解牛 公告回填(巨潮·轮转)`、`解牛 一年历史增量回填(新股补齐)`。

然后启用 worker 侧对应的三条：

Run:
```
DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx -e '
import { PrismaClient } from "./generated/prisma";
void (async () => {
  const db = new PrismaClient();
  const keys = ["ingest", "backfill-announcements", "backfill-year"];
  await db.jobState.updateMany({ where: { key: { in: keys } }, data: { enabled: true, nextFire: null } });
  console.table(await db.jobState.findMany({ select: { key: true, enabled: true } }));
  await db.$disconnect();
})();
' > /tmp/b1.log 2>&1; echo "EXIT=$?"; cat /tmp/b1.log
```
Expected: EXIT=0，这三条 `enabled: true`，其余六条 `false`。

- [ ] **Step 2: 观察第一批 24–48 小时**

判据（`backfill-year` 是日级，至少走满一整轮）：

- `/admin/jobs` 上三条都有 `ok` 的运行记录；
- `ingest` 每 30 分钟一轮，没有 `fail` / `timeout`；
- 拿 `coverage-report` 复核抓取没断：
  Run: `DATABASE_URL="postgresql://mac@localhost:5432/jieniu" NODE_ENV=development npx tsx src/scripts/coverage-report.ts --json > /tmp/c.log 2>&1; echo "EXIT=$?"; tail -1 /tmp/c.log`
  Expected: `n24` 明显大于 0。

有任何一条不满足就回滚这一批（worker 侧 `enabled: false` + hermit-ui 侧重新启用），先查清原因。

- [ ] **Step 3: 第二批（有 AI，无外部投递）**

hermit-ui 上禁用：`解牛 逻辑信号补齐(敏感度的原料)`、`解牛 热门股thesis补齐(deepseek·轮转)`、`解牛 AI早报brief生成(deepseek·每日)`。

Run:
```
DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx -e '
import { PrismaClient } from "./generated/prisma";
void (async () => {
  const db = new PrismaClient();
  const keys = ["backfill-signals", "backfill-thesis", "brief-morning"];
  await db.jobState.updateMany({ where: { key: { in: keys } }, data: { enabled: true, nextFire: null } });
  console.table(await db.jobState.findMany({ select: { key: true, enabled: true } }));
  await db.$disconnect();
})();
' > /tmp/b2.log 2>&1; echo "EXIT=$?"; cat /tmp/b2.log
```
Expected: EXIT=0，六条 `enabled: true`。

观察 24–48 小时，判据：三条都出现 `ok`；`backfill-signals` 的输出里「库内合计 T」在涨；没有 `skipped`（`skipped` = 密钥没注进来，说明启动脚本有问题）。

- [ ] **Step 4: 第三批（有外部副作用）**

hermit-ui 上禁用：`解牛 提醒事件生成(Outbox)`、`解牛日常维护 + 事件摘要 + 覆盖率巡检`、`解牛 每日复盘 + 推送(A股盘后)`。

Run:
```
DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx -e '
import { PrismaClient } from "./generated/prisma";
void (async () => {
  const db = new PrismaClient();
  const keys = ["alert-generate", "daily-maintenance", "daily-digest"];
  await db.jobState.updateMany({ where: { key: { in: keys } }, data: { enabled: true, nextFire: null } });
  console.table(await db.jobState.findMany({ select: { key: true, enabled: true } }));
  await db.$disconnect();
})();
' > /tmp/b3.log 2>&1; echo "EXIT=$?"; cat /tmp/b3.log
```
Expected: EXIT=0，九条全部 `enabled: true`。

**这一批的额外判据**（副作用最大，必须逐项核）：

- `daily-digest` 那轮的输出里有「邮件：候选 N 条｜发出 M 封｜失败 K 封」，且 `失败 = 0`；
- `daily-maintenance` 的 `dedup` 步骤 `overLimit` 为 `false`、`deleted` 是几十条量级（不是几千）；
- 判据阈值照抄自 cron prompt，**全市场扩容后 `news-7d` 与 `hot-thesis` 大概率会命中**——
  第一轮就会来告警信。这是预期的，先按日环比看趋势，别急着调阈值，
  也别急着断定是回归（详见设计稿 §16）。

- [ ] **Step 5: 观察满 7 天后清理**

九条全绿满 7 天，再在 hermit-ui `/cron` 页上把那 9 条**删除**。删之前先确认 `/admin/jobs` 上
九条各自都有连续 7 天的 `ok` 记录。

回滚随时可用：worker 侧置 `enabled: false`，hermit-ui 侧重新启用，两分钟。

---

## 自查记录

**Spec 覆盖**：设计稿 §4 架构 → Task 12/14；§5 任务定义 → Task 9；§6 数据模型 → Task 1；
§7 调度语义 → Task 2 + Task 12；§8 判据代码化 → Task 4/5/6/7；§9 AI 判断层 → Task 10；
§10 结果与告警 → Task 11/13；§11 密钥与脱敏 → Task 3 + Task 8 + Task 12 的 `bootCheck`；
§12 错误与超时 → Task 8 + Task 12；§13 测试 → 各 task 的 TDD 步骤 + Task 15；
§14 切换与回滚 → Task 17；§15 变更清单 → 全部覆盖，唯一偏离是 `effective-coverage.ts`
不加 `--json`（理由见「文件结构」一节）。

**待 sway 确认的一个值**：`OPS_ALERT_EMAIL` 的真实收件地址（Task 14 Step 2 先用 git 配置的邮箱占位，
第三批切换前必须换成真地址，否则告警信没人收）。
