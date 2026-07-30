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

const DEEPSEEK = {
  SKIP_ENV_VALIDATION: "1",
  OPENROUTER_MODEL: "deepseek/deepseek-chat",
};

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
            message:
              "跨源冗余数超过 200 条上限，本轮未删——需人工确认是不是判重逻辑出问题了",
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
        // 只留「零就是死了」这类真·硬失败当绝对阈值。`blankCompanies` / `pctNews7d`
        // 移到下面的 baselineChecks：它们是**结构性常数**（81 家退市壳永不归零；
        // 覆盖率阈值 85% 是 802 家时代定的，扩容到 5500 家后永久不达标），
        // 用绝对阈值就是每天必响，而每天必响等于没有告警。
        checks: [
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
        // 阈值按「正常波动的 10 倍以上」取：实测日间波动 blankCompanies ±3 家、
        // pctNews7d ±2 个点（7-30 因剪掉 3401 条榜单误绑掉了 1.7 个点，属最大的一次）。
        baselineChecks: [
          {
            id: "blank-companies",
            metric: "blankCompanies",
            op: "riseGt",
            delta: 20,
            message: "完全空白的公司一夜暴增——实体维护那一步坏了，或又灌进一批壳",
          },
          {
            id: "news-7d",
            metric: "pctNews7d",
            op: "dropGt",
            delta: 8,
            message: "近 7 天有资讯的公司占比骤降——抓取变慢或源被封",
          },
        ],
      },
      {
        // 数据卫生守望：不做清理，只报「该类错绑现在还剩多少」，由基线判据看它有没有涨。
        // run2 的结论——可持续形态是「入库端不产生 + 复发告警」，而不是周期跑一次性清理脚本
        // （那批脚本会漂出配套的入库逻辑，实测两个盲跑会造成损失）。
        name: "数据卫生守望",
        script: "src/scripts/hygiene-check.ts",
        args: ["--json"],
        env: { NODE_ENV: "development" },
        runEvenIfPrevFailed: true,
        baselineChecks: [
          {
            id: "roundup-misbound",
            metric: "roundupMisbound",
            op: "riseGt",
            delta: 30,
            message: "综述/榜单又开始绑到个股了——入库端的综述过滤器漏了新体裁",
          },
          {
            id: "dead-shell-bindings",
            metric: "deadShellBindings",
            op: "riseGt",
            delta: 200,
            message: "退市死壳身上的绑定在增长——它们又在当误绑磁石",
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
        // `dupeGroups` 在真实数据里天然非零：5 家公司同日各发一份《投资者关系活动记录表》
        // 就是 5 条同名标题，不是去重失效。稳定在 15 上下，只在暴增时才说明判重坏了。
        baselineChecks: [
          {
            id: "dupe-groups",
            metric: "dupeGroups",
            op: "riseGt",
            delta: 50,
            message: "重复组暴增——判重逻辑失效",
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
