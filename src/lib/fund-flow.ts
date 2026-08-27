/**
 * 个股「资金」卡的判定层（纯函数、无 IO、无 AI、全部可测）。
 *
 * 这一层存在的理由，是 2026-08-27 摸源时量到的两个数：
 *
 * ① **跨源不可比。** 同一天（8-27）同一只股，新浪与东财给的「主力净额」中位数差
 *    **50.9%**、最大差 **163.7%**：天孚通信东财 +15.47 亿 vs 新浪 +0.08 亿，
 *    胜宏科技 +19.53 亿 vs +0.74 亿。而两边的成交额/换手率/涨跌幅只差 0.7%~1%
 *    ——不是数据没结算，是**分档阈值与主动买卖归属规则本身不同**。
 * ② **单日方向近似抛硬币。** `docs/reference/radar-backtest.md` 的 60 个回放日 /
 *    480 条信号量到次日资金反转率 **51%–55%**。
 *
 * 所以这张卡的铁律：
 *  · **绝不把净额当结论摆在头条**。头条是档位 + 分位；金额只作次级信息，
 *    且一律取整到 0.1 亿并标「估算」。`strengthBand()` 是分数到展示的唯一闸口。
 *  · **中小单不作为第二条证据**。成交必然一买一卖，四档之和恒为 0，
 *    所以「中小单净流出」永远等于「主力净流入」的相反数——实测东财 8-27 生益科技
 *    f62 = f66+f72 = 25.31 亿，而 f78+f84 = −25.31 亿，分毫不差。
 *    它是同一个数的镜像，不是独立信息，因此只画成一条对比条、不摆三行数字。
 *  · **模式判定必须价量合看**，资金单独不下结论——沿用机会雷达 `gates.ts` 的同一条约束。
 */

import {
  amountRatioVs,
  netFlowSum,
  positiveFlowDays,
  returnOverDays,
  selfPercentile,
  type RadarBar,
} from "./radar/series";

// ---------------------------------------------------------------------------
// 阈值（集中在这里，别散到判定里）
// ---------------------------------------------------------------------------

/** 「价格基本没动」的上限（5 日累计涨幅绝对值，%）。用于「资金先动、价格没反映」。 */
export const FLAT_PRICE_PCT = 3;
/** 自身分位达到这个值算「异常放量」。 */
export const ANOMALY_PCT = 95;
/** 自身分位低于这个值算「异常缩量流出」。 */
export const ANOMALY_LOW_PCT = 5;
/** 资金强度分档的四个切点（0..100 分位）。 */
export const BAND_CUTS = [20, 40, 60, 80] as const;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 资金强度档位。**只有这五个词能出现在界面上**，不显示分数。 */
export type FundBand = "强" | "偏强" | "中性" | "偏弱" | "弱";

/**
 * 资金模式。命名对应 sway 2026-08-27 给的那张表；`none` = 不足以命名。
 *
 * `accumulation`（钱进价没动）与机会雷达的「刚刚启动」是同一件事，而回测显示
 * 这类信号**头 3 日超额是负的**（1 日 −0.00%、3 日 +0.70%），10 日才 +2.33%。
 * 所以它的 `caveat` 是必填的，不是客套。
 */
export type FundPattern =
  | "resonance" // 钱进 + 价涨：资金共振
  | "accumulation" // 钱进 + 价没动：资金先动，价格未反映
  | "distribution" // 钱出 + 价涨：高位派发风险
  | "capitulation" // 钱出 + 价跌：资金与价格同向走弱
  | "spike" // 单日异常放量流入（自身分位极高）
  | "none";

export type FundFlowInput = {
  /** 按交易日升序的日线（`RadarBar` 约定），最后一根是最新交易日。 */
  bars: RadarBar[];
  /**
   * 今日「主力净额 ÷ 成交额」在**全市场**的分位 0..100。
   * 拿不到传 null——留空比编一个数诚实（`percentileRank` 的空样本返回 50 是给
   * 内部评分用的中性值，不能直接摆给用户看）。
   */
  marketPct: number | null;
};

export type FundFlowCard = {
  /** 数据 as-of 交易日 YYYY-MM-DD。 */
  asOf: string;
  band: FundBand;
  /** 内部分数 0..100，**不展示**，只用于排序与档位。 */
  score: number;
  today: {
    netAmount: number | null;
    netRatio: number | null;
    amount: number | null;
    changePct: number;
    /** 超大单净额（元）。新浪 `r0_net`，回填未到位时为 null。 */
    xlNet: number | null;
    /** 大单净额 = 主力 − 超大单。两者任一缺失为 null。 */
    bigNet: number | null;
  };
  /** N 日主力净额合计（元）。 */
  sums: { d5: number | null; d20: number | null };
  /** N 日里净流入的天数。 */
  posDays: { d5: number; d20: number };
  /** N 日累计涨幅（%，官方涨跌幅连乘）。 */
  returns: { d5: number | null; d20: number | null };
  /** 今日 netRatio 在自身近 60 日的分位 0..100。 */
  selfPct: number | null;
  /** 今日 netRatio 在全市场的分位 0..100。 */
  marketPct: number | null;
  /** 当日成交额 ÷ 近 20 日均额（不含当日）。 */
  amountRatio20: number | null;
  /** 连续同向天数：正=连续净流入，负=连续净流出，0=今日无数据。 */
  streak: number;
  pattern: FundPattern;
  /** 模式的一句人话。确定性底稿，AI 只许润色不许改数。 */
  headline: string;
  /** 必读的限定条件；`accumulation` 一定非空。 */
  caveats: string[];
  /** 覆盖不足时说明缺什么，供前台决定要不要整块不渲染。 */
  missing: string[];
};

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/**
 * 分位 → 档位。**这是分数到展示之间的唯一闸口**（沿用 `score.ts` 的 §4 铁律：
 * 前台不显示 76.3 这种假精确数字）。
 */
export function strengthBand(score: number): FundBand {
  const [c0, c1, c2, c3] = BAND_CUTS;
  if (score < c0) return "弱";
  if (score < c1) return "偏弱";
  if (score < c2) return "中性";
  if (score < c3) return "偏强";
  return "强";
}

/**
 * 连续同向天数。从最新一根往回数，遇到方向不同或缺失就停。
 * 返回正数=连续净流入，负数=连续净流出。
 *
 * 净额恰为 0 的那天视为中断（0 既不是流入也不是流出，算进任一边都是编）。
 */
export function flowStreak(bars: RadarBar[]): number {
  const head = bars[bars.length - 1]?.netAmount ?? null;
  if (head === null || head === 0) return 0;
  const sign = head > 0 ? 1 : -1;
  let n = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    const v = bars[i]!.netAmount;
    if (v === null || v === 0) break;
    if (Math.sign(v) !== sign) break;
    n++;
  }
  return sign * n;
}

/**
 * 模式判定。**资金与价格必须合看**——只有资金一个方向的信息不足以命名任何模式，
 * 这是机会雷达 `gates.ts` 那条「资金不能单独定生死」在个股卡上的同一实现。
 *
 * 判定顺序即优先级：单日极端异常 > 背离（钱价不同向）> 同向。
 * 背离排在同向前面，因为「钱进价没动」和「钱出价涨」才是真正需要用户注意的两种，
 * 同向只是确认。
 */
export function classifyPattern(
  net5: number | null,
  ret5: number | null,
  selfPct: number | null,
): FundPattern {
  if (net5 === null || ret5 === null) return "none";
  const moneyIn = net5 > 0;
  const priceUp = ret5 > FLAT_PRICE_PCT;
  const priceDown = ret5 < -FLAT_PRICE_PCT;
  const priceFlat = !priceUp && !priceDown;

  // 单日异常必须同时是「流入」——分位高但净额为负说明它只是「比平时少流出」，
  // 那不是放量流入，摆成 spike 会读反。
  if (selfPct !== null && selfPct >= ANOMALY_PCT && moneyIn) return "spike";

  if (moneyIn && priceFlat) return "accumulation";
  if (!moneyIn && priceUp) return "distribution";
  if (moneyIn && priceUp) return "resonance";
  if (!moneyIn && priceDown) return "capitulation";
  // 钱出价平：既没背离也没确认，不给名字。
  return "none";
}

const YI = 1e8;

/** 金额 → 「X.X 亿」。**只到 0.1 亿**，不给两位小数（跨源差 50% 的数不配那个精度）。 */
export function yi(v: number): string {
  return `${(Math.abs(v) / YI).toFixed(1)} 亿`;
}

/** 数据落后了几个自然日。两个参数都是**已经算好的本地日历日** YYYY-MM-DD。 */
export function stalenessDays(asOf: string, today: string): number {
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((t - a) / 86_400_000));
}

/**
 * 数据是否旧到必须在卡面上说明。
 *
 * 阈值给 5 个自然日：周五收盘的数到下周三还没更新才算异常，正常周末不会误报。
 * 这条不是洁癖——2026-08-27 查生产时 `MarketDaily` 的最新完整交易日停在 8-21，
 * 而每天 15:50 的回补任务照常报 ok、告警照常响、没人处理。**卡面不写，用户就以为是今天的数。**
 */
export function isStale(asOf: string, today: string): boolean {
  return stalenessDays(asOf, today) > 5;
}

/** 分位 → 「前 N%」。分位 p 表示打败了 p% 的样本，所以「前」= 100−p。 */
export function topPct(p: number): string {
  const t = Math.max(1, Math.round(100 - p));
  return `前 ${t}%`;
}

/**
 * 从日线算出整张卡。`marketPct` 由调用方给（需要一次横截面查询，不在纯函数里做 IO）。
 *
 * 覆盖不足时不抛错，把缺什么写进 `missing` 让前台决定——「今天没有」和「数据没到」
 * 是两件事，混在一起就没法排查（`gates.ts` 的同一约定）。
 */
export function buildFundFlowCard(input: FundFlowInput): FundFlowCard | null {
  const { bars, marketPct } = input;
  const last = bars[bars.length - 1];
  if (!last) return null;

  const missing: string[] = [];
  if (last.netAmount === null) missing.push("今日主力净额");
  if (bars.length < 21) missing.push("20 日历史");

  const net5 = netFlowSum(bars, 5);
  const net20 = netFlowSum(bars, 20);
  const ret5 = returnOverDays(bars, 5);
  const ret20 = returnOverDays(bars, 20);
  const selfPct = selfPercentile(bars, (b) => b.netRatio, 60);
  if (selfPct === null) missing.push("60 日自身分位");
  const amountRatio20 = amountRatioVs(bars, 20);
  const streak = flowStreak(bars);
  const pattern = classifyPattern(net5, ret5, selfPct);

  // 分数：自身分位与全市场分位各半；只有一个就用那一个；都没有给中性 50。
  // 不引入绝对金额——那正是跨源差 50% 的那一项，拿它排序等于把口径差异排进了榜单。
  const parts = [selfPct, marketPct].filter((v): v is number => v !== null);
  const score =
    parts.length === 0
      ? 50
      : parts.reduce((a, b) => a + b, 0) / parts.length;

  const xlNet = last.netAmountXl ?? null;
  const bigNet =
    xlNet !== null && last.netAmount !== null ? last.netAmount - xlNet : null;

  return {
    asOf: last.day,
    band: strengthBand(score),
    score,
    today: {
      netAmount: last.netAmount,
      netRatio: last.netRatio,
      amount: last.amount,
      changePct: last.changePct,
      xlNet,
      bigNet,
    },
    sums: { d5: net5, d20: net20 },
    posDays: { d5: positiveFlowDays(bars, 5), d20: positiveFlowDays(bars, 20) },
    returns: { d5: ret5, d20: ret20 },
    selfPct,
    marketPct,
    amountRatio20,
    streak,
    pattern,
    headline: headlineFor(pattern, { net5, ret5, streak, selfPct }),
    caveats: caveatsFor(pattern),
    missing,
  };
}

function headlineFor(
  pattern: FundPattern,
  x: {
    net5: number | null;
    ret5: number | null;
    streak: number;
    selfPct: number | null;
  },
): string {
  const n5 = x.net5 === null ? "" : yi(x.net5);
  const r5 = x.ret5 === null ? "" : `${x.ret5 >= 0 ? "+" : ""}${x.ret5.toFixed(1)}%`;
  switch (pattern) {
    case "spike":
      return `今日大资金流入达到近 60 个交易日的${topPct(x.selfPct ?? 100)}，明显高于它自己平时的水平。`;
    case "accumulation":
      return `近 5 个交易日大资金合计净流入 ${n5}，同期股价 ${r5}——钱在动，价格还没反映。`;
    case "distribution":
      return `近 5 个交易日股价 ${r5}，但大资金合计净流出 ${n5}——价格在涨，钱在退。`;
    case "resonance":
      return `近 5 个交易日大资金净流入 ${n5}，股价 ${r5}，方向一致。`;
    case "capitulation":
      return `近 5 个交易日大资金净流出 ${n5}，股价 ${r5}，方向一致向下。`;
    default:
      return x.streak !== 0
        ? `大资金已连续 ${Math.abs(x.streak)} 个交易日净${x.streak > 0 ? "流入" : "流出"}，但价格与资金没有形成明确组合。`
        : "今日资金没有形成值得单独指出的组合。";
  }
}

function caveatsFor(pattern: FundPattern): string[] {
  const base =
    "「主力资金」是按单笔成交金额分档估算的，不是交易所披露的机构买卖；不同数据源口径不同，同一天同一只股可能差数倍。";
  switch (pattern) {
    case "accumulation":
      return [
        // 回测实测：这类信号前 3 日超额为负，10 日才转正。写进卡里是为了挡住
        // 「资金先动 = 明天就涨」这种读法——那正是它最容易被误读的方向。
        "「资金先动」不等于马上会涨：同类信号在我们的回放里，前 3 个交易日的超额收益是负的，要到 10 个交易日才转正。",
        base,
      ];
    case "spike":
      return [
        "单日资金异常的持续性很弱：回放里主力资金单日方向的次日反转率约五成，接近抛硬币。",
        base,
      ];
    default:
      return [base];
  }
}
