# 服务内调度器 —— 摆脱 hermit-ui cron

2026-07-29 · 设计稿

## 1. 背景与目标

解牛的 9 条数据管线目前挂在 hermit-ui 的 `/cron` 上：dashboard 存 prompt，gateway 的 `cron-runner`
到点起一个 tmux + `claude` 交互回合，把 prompt 发进去，让 Claude 去跑命令、读输出、写中文小结。

这套东西对**agent 级任务**（心跳、临时提醒）是对的，对**应用级数据管线**是错的：

- 解牛的存活性挂在另一个产品的 gateway 上；
- 每条管线烧一个完整的 Claude 交互回合，只为跑一条 `npx tsx`；
- 调度语义只有 `interval + jitter`，日级任务的钟点会无限漂（见 §2）；
- 运行记录长在 hermit-ui 的库里，解牛自己什么都不知道。

**目标**：把这 9 条搬进解牛自己的服务，**完全复刻，不丢功能**——包括今天由 Claude 承担的那部分
判断与中文小结（改由 OpenRouter 承担，见 §9）。

**非目标**：不动 hermit-ui 的 cron 能力本身；agent 级任务继续走 `cron` skill。不重构那 46 个
`src/scripts/*.ts`。不做任务的可视化编排 / 动态增删（任务定义就是代码）。

## 2. 现状盘点

导出的 9 条 cron，逐条拆到实际命令：

| key | 今天的名称 | 周期 | 实际执行 | AI | 分支 |
|---|---|---|---|---|---|
| `ingest` | 新闻定时抓取 | 30m ±5m | `ingest.ts` | — | 否 |
| `backfill-announcements` | 公告回填(巨潮·轮转) | 2h ±15m | `backfill-announcements.ts --limit=40` | — | 否 |
| `backfill-signals` | 逻辑信号补齐 | 2h ±12m | `backfill-signals.ts --limit=150 --concurrency=8` | deepseek | 否 |
| `alert-generate` | 提醒事件生成(Outbox) | 1h ±8m | `alert-dispatch.ts --generate` | — | 否 |
| `backfill-thesis` | 热门股 thesis 补齐 | 150m ±20m | `backfill-thesis.ts --limit=8` | deepseek | 否 |
| `brief-morning` | AI 早报 brief | 24h ±90m | `brief-recent.ts --limit=60 --hours=30` | deepseek | 否 |
| `daily-digest` | 每日复盘 + 推送 | 24h ±10m | `generate-market-digest.ts` → `alert-dispatch.ts --generate --email` | deepseek + 阿里邮件 | 严格串行 |
| `backfill-year` | 一年历史增量回填 | 24h ±25m | `backfill-year` → `backfill-reports` → `backfill-check` | — | 3 项体检判据 |
| `daily-maintenance` | 日常维护 + 巡检 | 24h ±20m | `fix-prefixed-names` → `dedup-cross-source` → `brief-recent --limit=40 --hours=24` → `coverage-report` + `effective-coverage` | deepseek | **≤200 才 apply** + 5 项回归判据 |

**7 条是纯「跑命令 + 报输出」，只有 `daily-maintenance` 有真分支。**所有判据都能写成代码。

### 钟点漂移（必须修，不能复刻）

实测触发时刻（北京时间）：

```
brief-morning      24h ±90m   17:31   ← 叫「早报」，在傍晚跑
daily-digest       24h ±10m   16:23
daily-maintenance  24h ±20m   16:01
backfill-year      24h ±25m   17:18
```

`nextFire = lastFire + 24h ± jitter` 是**随机游走**，每轮在上一轮基础上叠随机偏移，钟点必然无限漂。
"早报在下午五点半跑"不是配错了，是这个调度模型的必然结果。复刻它等于复刻一个 bug。

## 3. 不变量：「完全复刻」的定义

**必须逐字保留**：每条任务执行的脚本、命令行参数、步骤顺序、环境变量、幂等语义、
"空是正常"这类判定口径。

**允许改变（并已在 §2 / §7 / §10 说明理由）**：

1. 四条日级任务的触发时刻，由随机游走改为锚定钟点；
2. 重活之间加全局互斥（今天没有，是 `lessons.md` 记过的隐患）；
3. `dedup-cross-source` 的 ≤200 门从「两次扫描」合成「一次扫描内判定」；
4. 密钥注入从每任务 `secret exec` 改为 worker 进程继承；
5. 判断与中文小结的执行者从 Claude 交互回合改为 OpenRouter 调用。

## 4. 架构

```
pm2 ─┬─ jieniu-web        next start          (已有，本次纳入 pm2)
     └─ jieniu-scheduler  tsx src/scheduler/main.ts
                            │  每 30s tick，扫 JobState 找到期任务
                            └─ spawn ──> node_modules/.bin/tsx src/scripts/<x>.ts <args>
                                          （env 继承 worker，含密钥）
```

- 新目录 `src/scheduler/`，**全是新文件**，不动那 46 个脚本一行代码
  （共享工作区里有别的 session 在改代码，新逻辑一律开新文件）。
- `scripts/start-scheduler.sh` 是唯一启动入口，结构照抄 `start-prod.sh`：
  `secret exec OPENROUTER_API_KEY ALI_KEY ALI_SECRET -- pm2 start ...`。
  密钥写进**命令结构**，不写进文档。
- pm2 托管：崩溃自动拉起，开机随已有的 `ai.claudeclaw.pm2-resurrect.plist` 恢复。

### 为什么 spawn 子进程，而不是 import 进来跑

那 46 个脚本每个都自带 `const db = new PrismaClient()` 和**顶层 `main()`**——import 会立刻执行，
并各开一个连接池。spawn 是零改动的精确复刻，内存隔离；长回填被系统回收也只损失当前这片
（脚本全幂等，下轮原样续）。

### `tsx` 必须提到 `dependencies`

`tsx` 现在是 devDependency。worker 和所有任务都靠它，哪天 `npm ci --omit=dev` 就整条管线没了。
实施时移到 `dependencies`。

## 5. 任务定义

单一声明文件 `src/scheduler/jobs.ts`：

```ts
type SecretName = "OPENROUTER_API_KEY" | "ALI_KEY" | "ALI_SECRET";

type Schedule =
  | { kind: "interval"; everySec: number; jitterSec: number }
  | { kind: "daily"; atCST: string; jitterSec: number };   // "07:20"

type Step = {
  name: string;
  script: string;                    // "src/scripts/ingest.ts"
  args: string[];
  env?: Record<string, string>;      // 逐字照抄今天 cron 命令行里的
  requires?: SecretName[];           // 缺 key → **该步** skipped + 告警，绝不静默跑瞎；
                                     // 不依赖它的后续步骤照跑，全部步骤都被跳过才算整条任务 skipped
  timeoutMs?: number;                // 默认 45min
  runEvenIfPrevFailed?: boolean;     // 默认 false = 前一步失败即中止
  checks?: CheckDef[];               // 见 §8
};

type JobDef = {
  key: string;
  title: string;
  schedule: Schedule;
  heavy: boolean;                    // true = 与其他 heavy 任务全局互斥
  steps: Step[];
  alwaysNarrate?: boolean;           // 全绿也出 AI 小结（日级巡检）
};
```

九条任务的声明（参数逐字照抄今天的 cron）。`DATABASE_URL="postgresql://mac@localhost:5432/jieniu"`
由 worker 进程统一提供、子进程继承，不再逐条写在命令里；下表只列各步**额外**的 env。
`alwaysNarrate` 只有 `daily-maintenance` 与 `backfill-year` 为 true（见 §9）。

| key | schedule | heavy | steps |
|---|---|---|---|
| `ingest` | interval 1800s ±300s | 否 | `ingest.ts`（`NODE_ENV=development`） |
| `alert-generate` | interval 3600s ±480s | 否 | `alert-dispatch.ts --generate`（`SKIP_ENV_VALIDATION=1`） |
| `backfill-announcements` | interval 7200s ±900s | 是 | `backfill-announcements.ts --limit=40`（`SKIP_ENV_VALIDATION=1 NODE_ENV=development`） |
| `backfill-signals` | interval 7200s ±720s | 是 | `backfill-signals.ts --limit=150 --concurrency=8`（`SKIP_ENV_VALIDATION=1 OPENROUTER_MODEL=deepseek/deepseek-chat`，requires OPENROUTER，timeout 30min） |
| `backfill-thesis` | interval 9000s ±1200s | 是 | `backfill-thesis.ts --limit=8`（同上 env，requires OPENROUTER） |
| `daily-maintenance` | daily 03:10 ±15m | 是 | 见下 |
| `backfill-year` | daily 04:30 ±15m | 是 | ① `backfill-year.ts --months=12 --limit=30 --batch=10` ② `backfill-reports.ts --months=12 --limit=30 --batch=10` ③ `backfill-check.ts --json`（三步均 `NODE_ENV=development`） |
| `brief-morning` | daily 07:20 ±10m | 否 | `brief-recent.ts --limit=60 --hours=30`（`SKIP_ENV_VALIDATION=1 OPENROUTER_MODEL=deepseek/deepseek-chat`，requires OPENROUTER） |
| `daily-digest` | daily 15:40 ±5m | 是 | ① `generate-market-digest.ts`（`SKIP_ENV_VALIDATION=1`，requires OPENROUTER，timeout 60min） ② `alert-dispatch.ts --generate --email`（`SKIP_ENV_VALIDATION=1 MAIL_FROM="解牛 <noreply@mail.auramate.net>" ALI_REGION=cn-hangzhou`，requires ALI_KEY + ALI_SECRET） |

`daily-maintenance` 四步：

1. `fix-prefixed-names.ts`（`NODE_ENV=development`）
2. `dedup-cross-source.ts --max-apply=200 --json`（见 §8 的门改进）
3. `brief-recent.ts --limit=40 --hours=24`（`SKIP_ENV_VALIDATION=1 OPENROUTER_MODEL=deepseek/deepseek-chat`，
   requires OPENROUTER；**上限硬性 40，不调高**）
4. `coverage-report.ts --json` + `effective-coverage.ts --json`
   （`runEvenIfPrevFailed: true`——前面出错也要巡检，今天 Claude 也是这么做的）

钟点选择的理由：`brief-morning` 开盘前给出，名副其实；`daily-digest` 15:00 收盘后留 40 分钟等数据
落地；`daily-maintenance` 夜里跑，`dedup` 改数据不撞白天流量；`backfill-year` 接在维护之后，
错开避免抢 DB。

## 6. 数据模型

解牛自己的 Postgres 新增两张表：

```prisma
model JobState {
  key        String    @id
  lastFire   DateTime?
  nextFire   DateTime?      // 落库 → worker 重启后原样恢复
  lastStatus String?        // ok | fail | timeout | skipped
  enabled    Boolean   @default(true)
  runningAt  DateTime?      // 重入锁；超过 timeout 两倍视为死锁自动释放
}

model JobRun {
  id         String    @id @default(cuid())
  jobKey     String
  firedAt    DateTime  @default(now())
  finishedAt DateTime?
  status     String         // running | ok | fail | timeout | skipped
  exitCode   Int?
  output     String?   @db.Text   // 脱敏后的尾部 8KB
  metrics    Json?          // 各步 JSON_RESULT 的合并
  alerts     Json?          // 命中的判据
  narration  String?   @db.Text   // AI 小结（可空）
  durationMs Int?

  @@index([jobKey, firedAt])
}
```

迁移用 `prisma migrate dev` 生成正式迁移文件，**不用 `db push`**——已提交迁移悄悄过时是本项目
踩过的坑。

## 7. 调度语义

- `interval` 型：`nextFire = now + everySec ± uniform(jitterSec)`，与 hermit-ui 完全一致。
- `daily` 型：`nextFire` = 下一个 `atCST` 时刻 ± `uniform(jitterSec)`。
  中国自 1991 年起无夏令时，`Asia/Shanghai` 恒为 UTC+8，按固定偏移计算；
  单测拿 `Intl.DateTimeFormat({timeZone:'Asia/Shanghai'})` 对若干日期交叉验证。
- **恢复语义**：worker 启动读回 `nextFire`；已过期的**立刻补跑一次**，不补齐错过的所有轮次
  （今天也是这个语义）。从未跑过的任务视为立即到期。
- **重入**：同一任务永不并发（`runningAt` 锁）。
- **全局互斥**：`heavy: true` 的任务同时最多 1 个在跑。
  `lessons.md` 明确记着「并发跑两个长回填会被系统杀」，而 hermit-ui 只有 per-cron 锁、没有全局限制。
  轻活（`ingest` / `alert-generate`）不受限，照常并行。
- 被互斥挡下的任务**不改 `nextFire`**，下一 tick 重试；连续被挡 3 次记一条 `skipped` 运行并告警
  （防止某条重活饿死）。

## 8. 判据代码化

给四个脚本加 `--json`：`coverage-report` / `effective-coverage` / `backfill-check` /
`dedup-cross-source`。人类可读输出**一个字不改**，只在带 `--json` 时于**最后一行**多打
`JSON_RESULT {...}`，worker 解析这一行——不去正则爬中文报表。

`CheckDef` 形如 `{ id, metric, op, threshold, severity }`，由 worker 对 `metrics` 求值。
七项判据（前五项来自 `daily-maintenance`，后两项来自 `backfill-year`）：

| id | 条件 | 含义 |
|---|---|---|
| `blank-companies` | 完全空白公司 > 0 | 第 1 步没修好 |
| `news-7d` | 近 7 天有资讯 < 85% | 抓取变慢 / 源被封 |
| `ingest-24h` | 近 24h 新入库 = 0 | ingest 挂了（最严重） |
| `hot-thesis` | 热门宇宙 thesis < 100% | 重点覆盖有缺口 |
| `stock-bound` | 有绑定股票代码 < 99% | 又出孤儿公司 |
| `dupe-groups` | 重复组数 ≠ 0 | 去重失效 |
| `report-compliance` | 研报合规命中 ≠ 0 | 触碰研报铁律 |

**时间窗必须走 JS 侧比较，不能用 raw SQL 的 `now()`**：库里存的是 UTC 裸 `timestamp`，
`now()` 带时区，差 8 小时，会把活着的 ingest 判成挂了。

### `dedup` 的 ≤200 门

今天是 dry-run 扫一遍数 N、再 `--apply` 重扫一遍删——两次扫描之间集合可能变（TOCTOU），
且多一次全表扫描。改为脚本内 `--max-apply=N`：一次扫描内判定，`toDelete.length ≤ N` 就删，
超限只报数不删并在 `JSON_RESULT` 里标 `overLimit: true`（worker 据此告警）。
语义与今天一致：正常每日几十条会删，异常暴增时停手让人看。

## 9. AI 判断层（OpenRouter）

新文件 `src/scheduler/narrate.ts`，复用 `src/server/llm.ts` 的 `llmChat()`——那份客户端的注释
写明就是为 tsx 场景准备的（直读 `process.env`，不走 `~/env` 别名）。模型 `deepseek/deepseek-chat`
（anthropic / openai 在大陆 403，这是锁死的）。

**叫 AI 的三种情形**，对齐今天 Claude 真正在做判断的地方：

1. **判据命中** → 写「哪一项、数字怎么变的、可能原因、建议动作」。
   这正是今天 cron prompt 里那句"有异常则说明哪项、数字变化、可能原因与建议动作"。
2. **任务失败 / 超时 / 缺密钥被跳过** → 读 stderr 尾巴，判「这是什么错、要不要紧、要不要人工介入」。
3. **`alwaysNarrate` 的日级巡检**（`daily-maintenance` / `backfill-year`）全绿也出一段中文小结
   ——今天它每天就给你一段，这段不能丢。

稳态成功轮次**不叫 AI**：`ingest` 一天 48 轮、`alert-generate` 24 轮，机械模板一行就够
（与「稳态静默、异常推送」同一条原则，也省掉一天上百次没意义的调用）。

**四条护栏**：

1. **AI 只解释，不裁决。** `status` 与 `alerts` 全部由代码判定；AI 拿到的是「已判好的结论 +
   数字 + 输出尾巴」，只负责写因果与建议。
2. **必须喂环比。** 巡检小结最容易退化成"数据正常，继续观察"这种正确的废话，根因是没料而不是
   提示词。喂进去的必须含**上一轮同任务的 `metrics`**（`近7天 85.2% → 84.1%`、`近24h入库 312 → 0`）。
   取不到上一轮就不叫 AI，直接机械输出。
3. **AI 挂了不动任务状态。** narration 单独 try/catch，失败退回机械摘要并记
   `narration = "[AI 小结未生成] <原因>"`。绝不裸 `catch {}`。
4. **脱敏后再喂**（见 §11）。

## 10. 结果与告警落点

- **`/admin/jobs`**：只读，`robots: noindex`。9 张卡（每任务一张）：上次运行时刻 / 状态 / 耗时，
  最近 20 次的迷你时间线，展开看**脱敏后**的输出尾巴 + AI 小结 + 命中判据。
  **不放触发 / 禁用按钮**——页面现在公网可达且不设防，只读的运行记录挂着没问题，能改数据的按钮
  风险不对等。超管落地后再加写操作。
- **邮件**：只在①任务 `fail` / `timeout` / `skipped`，或②任一判据命中时发。稳态静默。
  收件人由 `OPS_ALERT_EMAIL` 环境变量指定（在 `scripts/start-scheduler.sh` 里设），
  未设则只落库不发信并在启动自检里喊一声。复用现有的阿里 DirectMail 通道。
- 同一任务连续失败时**每条任务每 6 小时最多一封**，避免半夜被同一个故障刷屏。

## 11. 密钥与脱敏

- worker 由 `scripts/start-scheduler.sh` 用 `secret exec` 起，子进程继承——**9 条命令里的
  `secret exec` 全部不再需要**。
- worker 启动打一行 `[scheduler] ✓/✗ 密钥…`（只打名不打值），缺 key 时 `requires` 该 key 的任务
  直接 `skipped` + 告警，**不假装干过活**。这是补 7-25 那次"密钥静默缺失、脚本照报完成 0 条"。
- **脱敏**：`src/server/alert-mailer.ts` 会打 `[alert-mail] → <用户邮箱>｜…`，真实用户邮箱进 stdout。
  stdout 尾巴在①落 `JobRun.output` ②送 OpenRouter 之前，都过一遍邮箱掩码（`a***@x.com`）。
  第①条尤其要紧：admin 页公网可达且不设防。

## 12. 错误与超时

- 每步 spawn 带 `timeoutMs`（默认 45min；`backfill-signals` 30min，`generate-market-digest` 60min）。
  超时先 SIGTERM，5 秒后 SIGKILL，标 `timeout`。
- 多步任务串行；前一步非 0 即中止后续，除非该步标了 `runEvenIfPrevFailed`。
- worker 自身崩溃由 pm2 拉起，读回 `nextFire` 续跑；`runningAt` 超过该任务 timeout 两倍
  判定为死锁，自动释放。
- 状态语义沿用 hermit-ui 的教训：状态描述的是**观察到的事实**，不是对业务成败的猜测。
  `ok` = 退出码 0；`fail` = 非 0；`timeout` = 撞上限；`skipped` = 缺密钥 / 被互斥连续挡下。
  业务是否真的做成，看 `metrics` 与判据。

## 13. 测试

- **纯函数单测**：`nextFire` 计算（interval + jitter 边界、daily 锚点跨零点、与 `Intl` 交叉验证）、
  判据求值、邮箱脱敏、`JSON_RESULT` 解析（含"最后一行不是 JSON"的降级）。
- **`--json` 四个脚本必须打真库冒烟**：夹具照自己想象写会全绿而线上全空
  （`lessons.md`「类型声明不是事实」）。验收项是"真库跑一遍，7 项判据都拿到数"，
  不是"单测通过"。
- **端到端**：造一个假 job（`echo` 一行 `JSON_RESULT`），跑通 spawn → 落 `JobRun` → 判据命中 →
  发信 → 页面显示。
- **AI 层验鉴别力**：同一套 harness 喂一份全绿、一份 `近24h入库=0`，前者不该报警、
  后者必须点名这一项。先证明它抓得住，再信它的绿灯。
- 部署前置门槛照旧三件套：`vitest run` + `tsc --noEmit` + `next lint`，且都在 `build` **之前**跑。
  验证命令一律 `cmd > /tmp/x.log 2>&1; echo "EXIT=$?"`，**绝不 `cmd | tail; echo $?`**
  （管道后的 `$?` 是 `tail` 的退出码）。

## 14. 切换与回滚

**不双跑**——重复烧 AI，且 `daily-digest` 有重复发信风险。逐条切，每条是两步原子操作：
hermit-ui 上**禁用（不删）** → worker 上启用。按副作用从小到大分三批：

1. `ingest`、`backfill-announcements`、`backfill-year`（脚本层无 AI、无外部投递；
   `backfill-year` 的 AI 只出现在小结层，不改数据）
2. `backfill-signals`、`backfill-thesis`、`brief-morning`（有 AI，无外部投递）
3. `alert-generate`、`daily-maintenance`（含 `dedup` 改数据）、`daily-digest`（发信）

每批观察 24–48 小时，日级任务至少走满一整轮。全绿满 7 天再删 hermit-ui 上那 9 条。
回滚是反着来：worker 禁用 + hermit-ui 启用，两分钟。

## 15. 变更清单

**新增**

- `src/scheduler/main.ts` — worker 主循环（tick / 到期判定 / 派发）
- `src/scheduler/jobs.ts` — 9 条任务声明
- `src/scheduler/schedule.ts` — `nextFire` 计算（纯函数）
- `src/scheduler/runner.ts` — spawn / 超时 / 输出收集 / 落 `JobRun`
- `src/scheduler/checks.ts` — `JSON_RESULT` 解析 + 判据求值
- `src/scheduler/narrate.ts` — OpenRouter 小结
- `src/scheduler/notify.ts` — 告警邮件（含节流）
- `src/scheduler/redact.ts` — 邮箱脱敏
- `src/app/admin/jobs/page.tsx` — 只读运行记录页
- `scripts/start-scheduler.sh` — 唯一启动入口
- `prisma/migrations/<ts>_job_state_run/` — 两张新表

**改动（最小）**

- `src/scripts/coverage-report.ts` / `effective-coverage.ts` / `backfill-check.ts` — 加 `--json`
- `src/scripts/dedup-cross-source.ts` — 加 `--max-apply=N` + `--json`
- `package.json` — `tsx` 从 `devDependencies` 移到 `dependencies`
- `docs/reference/deploy.md` — 补 scheduler 的启停与排查
- `../../AGENTS.md` — 铁律改为分治表述：agent 级任务走 `cron` skill；
  解牛应用级管线走服务内 scheduler

## 16. 已知风险

- **worker 与 web 是两个进程**，改了 `src/server/*` 的共享代码后，只重启 web 不重启 worker
  会让两边跑不同版本。部署流程里 scheduler 必须跟着重启，写进 `deploy.md`。
- **admin 页暂不设防**。已用只读 + `noindex` + 脱敏把危害压到最低，但这是临时状态，
  超管落地前不要在该页加任何写操作。
- **判据阈值是从今天的 cron prompt 逐字抄来的**（85% / 99% / 100% / 200 条），
  全市场扩容后 `news-7d < 85%` 与 `hot-thesis < 100%` 已是长期命中态；
  切换后头两周按日环比看，必要时调阈值——但调之前先确认是阈值不合时宜，不是真的回归了。
