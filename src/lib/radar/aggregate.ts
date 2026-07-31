/**
 * 个股逐日序列 → 行业聚合 + 全 A 基准（纯函数、无 IO、可测）。
 *
 * 板块归属沿用解牛自己的 `STOCK --BELONGS_TO--> SECTOR`（131 个板块 / 5300+ 只股），
 * 与 `lib/rotation.ts`、板块页、热门覆盖同一套口径——换一套会两边对不上。
 *
 * 一条贯穿的规矩：**各窗口只用历史够长的成分股算，并把用了几只报出来**（`coverageN`）。
 * 拿短样本冒充全样本，会让"新股扎堆的板块"看起来涨得特别猛。
 */

import {
  returnOverDays,
  positiveFlowDays,
  netFlowSum,
  amountRatioVs,
  mean,
  type RadarBar,
} from "./series";

export type StockSeries = {
  ticker: string;
  entityId: string;
  name: string;
  sector: string | null;
  /** 按交易日升序 */
  bars: RadarBar[];
};

/** 成分股少于这个数的板块不参与——几只股的均值没有代表性（沿用 rotation.ts 的口径）。 */
export const MIN_MEMBERS = 5;

/** 回到 k 个交易日前的视角（砍掉最后 k 根）。 */
export function atOffset(bars: RadarBar[], k: number): RadarBar[] {
  return k <= 0 ? bars : bars.slice(0, Math.max(0, bars.length - k));
}

/**
 * 涨停判定。A 股涨跌幅限制按板块分档，用同一个 10% 判会把创业板/科创板的
 * 正常波动全判成涨停（也会漏掉北交所真正的 30cm 涨停）。
 */
export function isLimitUp(ticker: string, changePct: number): boolean {
  const t = ticker.trim();
  if (t.startsWith("30") || t.startsWith("688")) return changePct >= 19.5;
  if (t.startsWith("8") || t.startsWith("4") || t.startsWith("92"))
    return changePct >= 29.5;
  return changePct >= 9.8;
}

export type MarketBenchmark = {
  ret3: number | null;
  ret5: number | null;
  ret20: number | null;
  /** 参与计算的个股数（各窗口可能不同，取 3 日窗口的） */
  breadthUpShare: number | null;
  covered: number;
};

/** 全 A 等权基准。「跑赢全A」的那个"全A"就是这里。 */
export function marketBenchmark(all: StockSeries[]): MarketBenchmark {
  const win = (n: number) =>
    mean(
      all
        .map((s) => returnOverDays(s.bars, n))
        .filter((v): v is number => v !== null),
    );
  const todays = all
    .map((s) => s.bars[s.bars.length - 1]?.changePct)
    .filter((v): v is number => typeof v === "number");
  return {
    ret3: win(3),
    ret5: win(5),
    ret20: win(20),
    breadthUpShare:
      todays.length === 0
        ? null
        : todays.filter((c) => c > 0).length / todays.length,
    covered: all.length,
  };
}

export type SectorAggregate = {
  sector: string;
  members: number;
  /** 今日 */
  avgChangePct: number;
  up: number;
  down: number;
  upShare: number;
  limitUpShare: number;
  amountToday: number | null;
  netAmountToday: number | null;
  netRatioToday: number | null;
  /** 时序 */
  upShareAvg5: number | null;
  ret3: number | null;
  ret5: number | null;
  ret20: number | null;
  coverage3: number;
  coverage5: number;
  coverage20: number;
  posFlowDays3: number;
  posFlowDays5: number;
  netFlow3: number | null;
  netFlow5: number | null;
  amountRatio20: number | null;
  top2Concentration: number | null;
  top3Concentration: number | null;
  priceUpFlowOut: boolean;
  /** 板块自身的合成日序列，供「相对自身 60 日」的分位计算 */
  synthetic: RadarBar[];
  /** 板块内主力净额最大的几只（做代表股候选） */
  leaders: { ticker: string; entityId: string; name: string; netAmount: number }[];
};

/**
 * 把成分股序列聚合成板块序列。
 *
 * 合成日序列的口径：净额/成交额**求和**（资金是可加的），涨跌幅**等权平均**
 * （与 `lib/rotation.ts` 的 `avgChangePct` 一致，全站同一把尺子），
 * `close` 由等权涨跌幅链式累乘成一条指数——只用于"相对自身"的形态判断，不对外展示。
 */
export function aggregateSector(
  sector: string,
  members: StockSeries[],
): SectorAggregate | null {
  if (members.length < MIN_MEMBERS) return null;
  const days = Math.max(...members.map((m) => m.bars.length));
  if (days === 0) return null;

  // 以「最长的那只」为日历轴，逐日对齐（成分股缺日=停牌，不参与那天的统计）
  const byDay = new Map<string, RadarBar[]>();
  for (const m of members) {
    for (const b of m.bars) {
      const arr = byDay.get(b.day);
      if (arr) arr.push(b);
      else byDay.set(b.day, [b]);
    }
  }
  const dayKeys = [...byDay.keys()].sort();
  const synthetic: RadarBar[] = [];
  let idx = 100;
  for (const day of dayKeys) {
    const bs = byDay.get(day)!;
    const avgChg = mean(bs.map((b) => b.changePct)) ?? 0;
    idx = idx * (1 + avgChg / 100);
    const nets = bs
      .map((b) => b.netAmount)
      .filter((v): v is number => v !== null);
    const amts = bs.map((b) => b.amount).filter((v): v is number => v !== null);
    const net = nets.length ? nets.reduce((a, b) => a + b, 0) : null;
    const amt = amts.length ? amts.reduce((a, b) => a + b, 0) : null;
    synthetic.push({
      day,
      close: idx,
      changePct: avgChg,
      amount: amt,
      netAmount: net,
      netRatio: net !== null && amt ? net / amt : null,
      turnoverRate: null,
    });
  }

  const lastDay = dayKeys[dayKeys.length - 1]!;
  const todayBars = byDay.get(lastDay)!;
  const todayOf = new Map(
    members.map((m) => {
      const b = m.bars[m.bars.length - 1];
      return [m.ticker, b?.day === lastDay ? b : null] as const;
    }),
  );

  const up = todayBars.filter((b) => b.changePct > 0).length;
  const down = todayBars.filter((b) => b.changePct < 0).length;
  const limitUps = members.filter((m) => {
    const b = todayOf.get(m.ticker);
    return b ? isLimitUp(m.ticker, b.changePct) : false;
  }).length;

  // 各窗口只用够长的成分股
  const winOf = (n: number) => {
    const xs = members
      .map((m) => returnOverDays(m.bars, n))
      .filter((v): v is number => v !== null);
    return { value: mean(xs), covered: xs.length };
  };
  const w3 = winOf(3);
  const w5 = winOf(5);
  const w20 = winOf(20);

  // 过去 5 日（不含今日）的上涨占比均值
  const prevShares: number[] = [];
  for (const day of dayKeys.slice(-6, -1)) {
    const bs = byDay.get(day)!;
    if (bs.length > 0) prevShares.push(bs.filter((b) => b.changePct > 0).length / bs.length);
  }

  // 资金集中度：只算流入侧——「谁在买」才是集中度要回答的问题
  const inflows = members
    .map((m) => {
      const b = todayOf.get(m.ticker);
      return { m, net: b?.netAmount ?? null };
    })
    .filter((x): x is { m: StockSeries; net: number } => x.net !== null && x.net > 0)
    .sort((a, b) => b.net - a.net);
  const totalIn = inflows.reduce((a, x) => a + x.net, 0);
  const topN = (n: number) =>
    totalIn > 0
      ? inflows.slice(0, n).reduce((a, x) => a + x.net, 0) / totalIn
      : null;

  const todaySyn = synthetic[synthetic.length - 1]!;
  const last3 = synthetic.slice(-3);
  const priceUpFlowOut =
    todaySyn.changePct > 0 &&
    last3.length === 3 &&
    last3.every((b) => b.netAmount !== null && b.netAmount < 0);

  return {
    sector,
    members: members.length,
    avgChangePct: Math.round(todaySyn.changePct * 100) / 100,
    up,
    down,
    upShare: todayBars.length ? up / todayBars.length : 0,
    limitUpShare: members.length ? limitUps / members.length : 0,
    amountToday: todaySyn.amount,
    netAmountToday: todaySyn.netAmount,
    netRatioToday: todaySyn.netRatio,
    upShareAvg5: mean(prevShares),
    ret3: w3.value,
    ret5: w5.value,
    ret20: w20.value,
    coverage3: w3.covered,
    coverage5: w5.covered,
    coverage20: w20.covered,
    posFlowDays3: positiveFlowDays(synthetic, 3),
    posFlowDays5: positiveFlowDays(synthetic, 5),
    netFlow3: netFlowSum(synthetic, 3),
    netFlow5: netFlowSum(synthetic, 5),
    amountRatio20: amountRatioVs(synthetic, 20),
    top2Concentration: topN(2),
    top3Concentration: topN(3),
    priceUpFlowOut,
    synthetic,
    leaders: inflows.slice(0, 6).map((x) => ({
      ticker: x.m.ticker,
      entityId: x.m.entityId,
      name: x.m.name,
      netAmount: x.net,
    })),
  };
}

/**
 * 行业强弱排名的变化：今天的名次 vs `k` 个交易日前的名次。正数=上升。
 * 用于「刚刚启动」第④条的备选判据（跑输全 A 但排名明显上升，也算开始改善）。
 */
export function sectorRankUp(
  sector: string,
  nowScores: Map<string, number>,
  thenScores: Map<string, number>,
): number | null {
  if (!nowScores.has(sector) || !thenScores.has(sector)) return null;
  const rank = (m: Map<string, number>) => {
    const order = [...m.entries()].sort((a, b) => b[1] - a[1]);
    return new Map(order.map(([k], i) => [k, i]));
  };
  const rn = rank(nowScores).get(sector)!;
  const rt = rank(thenScores).get(sector)!;
  return rt - rn;
}
