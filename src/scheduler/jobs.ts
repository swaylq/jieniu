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
  {
    /**
     * 机会雷达（两步串行）：先把当天的逐日行情+主力资金补进 `MarketDaily`，再算信号。
     * 顺序不能反——信号完全建立在 `MarketDaily` 上，先算等于用昨天的数据出今天的卡。
     *
     * 新任务默认 `enabled=false`（见 main.ts 的 ensureStates），要在 /admin/jobs
     * 上显式开启；别指望「起完赶紧去关」（切换那轮已经证明抢不过第一个 tick）。
     */
    key: "opportunity-radar",
    title: "机会雷达（逐日行情回补 + 信号生成）",
    schedule: { kind: "daily", atCST: "15:50", jitterSec: 300 },
    heavy: true,
    steps: [
      {
        name: "逐日行情回补",
        // days=8 只刷最近几天（历史日收盘后不变）；minDays 给大数=全市场都过一遍
        script: "src/scripts/backfill-market-daily.ts",
        args: ["--limit=6000", "--days=8", "--minDays=99999", "--concurrency=8"],
        env: { SKIP_ENV_VALIDATION: "1", NODE_ENV: "development" },
        timeoutMs: 30 * 60_000,
        checks: [
          {
            id: "market-daily-failed",
            metric: "failed",
            op: "gt",
            threshold: 400,
            message:
              "逐日行情有 400 只以上取不到——新浪限流或接口变更，当天的雷达信号会缺料",
          },
        ],
      },
      {
        name: "生成机会信号",
        script: "src/scripts/generate-radar.ts",
        args: ["--ai"],
        env: DEEPSEEK,
        requires: ["OPENROUTER_API_KEY"],
        timeoutMs: 30 * 60_000,
        // 「今天没有信号」是**合法输出**，所以这里不设「sectors < 1 就告警」的判据；
        // 只在 AI 全线失败时提醒——那是密钥/供应商问题，不是市场问题。
        checks: [
          {
            id: "radar-ai-all-failed",
            metric: "aiFailed",
            op: "gte",
            threshold: 8,
            message:
              "机会卡的 AI 润色全部失败（已退回确定性底稿，页面仍可用）——查 OPENROUTER_API_KEY 与供应商可用性",
          },
        ],
      },
      {
        /**
         * 滚动回测（需求 §12「用滚动历史数据调整阈值」）。
         *
         * 逆势走强首轮只有 14 条样本，不足以下结论——这不是工程量问题、是样本量问题，
         * 只能靠攒。攒在管道里而不是空等：每天回放最近 5 个交易日，把三类信号的
         * 10 日超额 / 胜率 / 样本量 / 回撤 / 次日资金反转率写进 JobRun.metrics。
         *
         * 只读，不落库。判据用**基线式**（与上次成功运行比）而不是绝对阈值——
         * 「超额低于 X」这种绝对线在不同市场状态下会天天响，等于没有告警。
         */
        name: "滚动回测",
        script: "src/scripts/radar-backtest.ts",
        args: ["--days=5", "--horizon=10"],
        env: { SKIP_ENV_VALIDATION: "1", NODE_ENV: "development" },
        timeoutMs: 20 * 60_000,
        // 前一步失败也照跑：回测只读历史，不依赖今天的信号是否生成成功
        runEvenIfPrevFailed: true,
        baselineChecks: [
          {
            id: "radar-sector-confirmed-degrade",
            metric: "sector_CONFIRMED_x10",
            op: "dropGt",
            // 首轮 +1.94pp；跌超 4pp 才算劣化——阈值要比正常波动高一个量级
            delta: 4,
            message:
              "「趋势形成」的 10 日超额比上次回测掉了 4 个百分点以上——判据可能在当前市场状态下失效，看一眼再决定要不要调阈值",
          },
          {
            id: "radar-flow-reversal-rise",
            metric: "sector_EARLY_rev",
            op: "riseGt",
            // 首轮 54%；升超 20pp 说明资金信号的噪音水平变了
            delta: 20,
            message:
              "「刚刚启动」的次日资金反转率比上次高 20 个百分点以上——主力资金估算口径可能变了或数据源出了问题",
          },
        ],
      },
    ],
  },
];
