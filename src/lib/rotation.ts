/**
 * 板块轮动 / 个股发现（A 股）——纯函数层。
 *
 * 数据来源是**每只股的涨跌幅 + 主力净流入**（东财口径），板块归属用解牛自己的
 * `STOCK --BELONGS_TO--> SECTOR` 分类（140 个板块 / 5356 只股），不借第三方的板块口径——
 * 全站其它地方（板块页、热门覆盖）用的都是这套，换一套会两边对不上。
 *
 * 铁律：
 *  ① 只做**客观统计的搬运与聚合**，不出买卖建议、不预测涨跌。「共振/共跌/分化」描述的是
 *     成分股步调是否一致，是对已发生行情的描述，不是信号。
 *  ② 主力净流入是**东财的计算口径**（按成交单笔金额分档），不是交易所披露数据，展示时须注明。
 *  ③ 排序规则写死在代码里且可测——不能是「凭感觉调出来的黑箱」。
 */

export type StockFlow = {
  code: string;
  name: string;
  price: number;
  changePct: number;
  /** 主力净流入（元）。正=净流入。 */
  netInflow: number;
  /** 主力净占比（%）。 */
  inflowRatio: number;
};

/** 成分股少于这个数的板块不参与轮动——几只股的均值没有代表性。 */
export const MIN_MEMBERS = 5;
/** 多数占比达到这个阈值才算「步调一致」。 */
export const ALIGN_THRESHOLD = 0.7;
/** 同一板块在「个股发现」里最多占几席——防一个强势板块霸屏。 */
export const MAX_PER_SECTOR = 2;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 东财 `clist` 响应 → 个股行数组。停牌/无数据的行（字段是 `"-"`）直接丢弃，不当 0。 */
export function parseFlowRows(json: unknown): StockFlow[] {
  const diff = (json as { data?: { diff?: unknown } } | null)?.data?.diff;
  if (!Array.isArray(diff)) return [];
  const out: StockFlow[] = [];
  for (const item of diff) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const code = typeof r.f12 === "string" ? r.f12.trim() : "";
    const name = typeof r.f14 === "string" ? r.f14.trim() : "";
    const price = num(r.f2);
    const changePct = num(r.f3);
    const netInflow = num(r.f62);
    if (!code || !name || price === null || changePct === null || netInflow === null)
      continue;
    out.push({
      code,
      name,
      price,
      changePct,
      netInflow,
      inflowRatio: num(r.f184) ?? 0,
    });
  }
  return out;
}

export type SectorAgg = {
  sector: string;
  members: number;
  up: number;
  down: number;
  flat: number;
  avgChangePct: number;
  netInflow: number;
  /** 涨跌两侧的多数占比（0.5~1）。越接近 1 说明成分股步调越一致。 */
  alignment: number;
  /**
   * 代表股：按**板块自身方向**取主力资金前三——上涨板块取买得最多的，下跌板块取卖得最多的。
   * 若一律按净流入降序，共跌板块选出来的会是「最抗跌的那几只」，跟「代表这个板块在跌」正好相反。
   */
  leaders: StockFlow[];
};

/** 按板块归属聚合。`membership` 是 code → 板块名。不在任何板块的个股被忽略。 */
export function aggregateSectors(
  stocks: StockFlow[],
  membership: Map<string, string>,
): SectorAgg[] {
  const bucket = new Map<string, StockFlow[]>();
  for (const s of stocks) {
    const sec = membership.get(s.code);
    if (!sec) continue;
    const arr = bucket.get(sec);
    if (arr) arr.push(s);
    else bucket.set(sec, [s]);
  }

  const out: SectorAgg[] = [];
  for (const [sector, list] of bucket) {
    if (list.length < MIN_MEMBERS) continue;
    const up = list.filter((s) => s.changePct > 0).length;
    const down = list.filter((s) => s.changePct < 0).length;
    const flat = list.length - up - down;
    const avg = list.reduce((a, s) => a + s.changePct, 0) / list.length;
    const net = list.reduce((a, s) => a + s.netInflow, 0);
    out.push({
      sector,
      members: list.length,
      up,
      down,
      flat,
      avgChangePct: Math.round(avg * 100) / 100,
      netInflow: net,
      alignment: Math.max(up, down) / list.length,
      leaders: [...list]
        .sort((a, b) => (avg >= 0 ? b.netInflow - a.netInflow : a.netInflow - b.netInflow))
        .slice(0, 3),
    });
  }
  return out;
}

export type RotationSignal = "共振" | "共跌" | "分化";
export type RankedSector = SectorAgg & { signal: RotationSignal };

function signalOf(a: SectorAgg): RotationSignal {
  if (a.alignment < ALIGN_THRESHOLD) return "分化";
  return a.up >= a.down ? "共振" : "共跌";
}

/**
 * 轮动排序：**rank-sum**（三个维度各自排名后相加，取名次和最小的）。
 *
 * 三个维度：`|均涨跌|`、步调一致度、`|主力净流入|`。用绝对值是因为**强跌也是轮动**——
 * 资金从一个板块撤出和涌入另一个板块是同一件事的两面，只看涨会漏掉一半信息。
 * 用名次和而不是加权求和：三个维度量纲完全不同（%、比例、元），加权就得拍系数，
 * 那就成了「凭感觉调出来的黑箱」；名次和无量纲、可解释、可测。
 */
export function rankSectors(aggs: SectorAgg[], limit: number): RankedSector[] {
  if (aggs.length === 0) return [];
  const rankBy = (key: (a: SectorAgg) => number) => {
    const order = [...aggs].sort((x, y) => key(y) - key(x));
    const m = new Map<string, number>();
    order.forEach((a, i) => m.set(a.sector, i));
    return m;
  };
  const rChange = rankBy((a) => Math.abs(a.avgChangePct));
  const rAlign = rankBy((a) => a.alignment);
  const rFlow = rankBy((a) => Math.abs(a.netInflow));

  return [...aggs]
    .sort((x, y) => {
      const sx = rChange.get(x.sector)! + rAlign.get(x.sector)! + rFlow.get(x.sector)!;
      const sy = rChange.get(y.sector)! + rAlign.get(y.sector)! + rFlow.get(y.sector)!;
      if (sx !== sy) return sx - sy;
      return Math.abs(y.avgChangePct) - Math.abs(x.avgChangePct);
    })
    .slice(0, limit)
    .map((a) => ({ ...a, signal: signalOf(a) }));
}

export type Discovery = StockFlow & { sector: string; reason: string };

function yi(n: number): string {
  const v = n / 1e8;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}亿`;
}

/**
 * 个股发现：只从**已入选的轮动板块**里挑，且只挑资金净流入为正的。
 * 「发现」必须能说出它属于哪条正在动的线——脱离板块的单股异动是噪音。
 *
 * 同板块限 `MAX_PER_SECTOR` 席：全市场只有一两个板块共振时，那个板块会把发现位全占掉
 * （实跑第一版 5 条里 3 条白酒）。这是解牛治过的同类问题——早报单公司霸屏。
 * 宁可少给几条，也不破上限凑数。
 */
export function discoverStocks(
  stocks: StockFlow[],
  membership: Map<string, string>,
  ranked: RankedSector[],
  limit: number,
): Discovery[] {
  const inPlay = new Set(ranked.map((r) => r.sector));
  return stocks
    .filter((s) => {
      const sec = membership.get(s.code);
      return !!sec && inPlay.has(sec) && s.netInflow > 0;
    })
    .map((s) => {
      const sector = membership.get(s.code)!;
      return {
        ...s,
        sector,
        reason: `涨${s.changePct.toFixed(1)}% · 主力净流入${yi(s.netInflow)} · 板块：${sector}`,
      };
    })
    .sort(
      (a, b) =>
        b.changePct * Math.log10(b.netInflow + 10) -
        a.changePct * Math.log10(a.netInflow + 10),
    )
    .reduce<Discovery[]>((acc, d) => {
      if (acc.length >= limit) return acc;
      if (acc.filter((x) => x.sector === d.sector).length >= MAX_PER_SECTOR) return acc;
      acc.push(d);
      return acc;
    }, []);
}
