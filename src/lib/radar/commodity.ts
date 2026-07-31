/**
 * 产业链商品价格 → 行业级催化证据（纯函数、无 IO、可测）。
 *
 * 为什么要有这一层：需求 §6 把「产品价格」列在催化的**高**档，而站内原来只有
 * `EntitySignal(kind="commodity")` 两条，且挂在「新能源 / 光伏」这两个**没有成分股绑定**
 * 的板块实体上（雷达用的是「电池 / 光伏设备」），等于对机会雷达零贡献。
 *
 * 两条设计约束：
 *  ① **小幅波动不是催化**。0.3% 的日内波动是噪音；只有达到 `MOVE_MEDIUM` 才算事件，
 *     达到 `MOVE_HIGH` 才够「高」档。否则每天 20 个品种都会变成 20 条"催化"，
 *     那是把噪音包装成信息（同「pull 宽 push 严」那条教训）。
 *  ② 证据必须**可点开**（需求 §8）。商品价格没有站内新闻 id，所以这里产出的是
 *     **自带 url 的独立证据**，由 `OpportunitySignal.extraEvidence` 承载，
 *     不混进 `catalystNewsIds`（那一列的语义是站内资讯主键）。
 */

import type { CatalystGrade } from "./score";
import type { GradedCatalyst } from "./catalyst";

/** 达到这个绝对涨跌幅（%）算「高」档催化。 */
export const MOVE_HIGH = 3;
/** 达到这个绝对涨跌幅（%）算「中」档催化；低于它不算催化。 */
export const MOVE_MEDIUM = 1.5;

export type CommodityDef = {
  /** 新浪期货主力连续符号 */
  sym: string;
  name: string;
  unit: string;
  /**
   * 挂到哪些板块。**必须是库里真实有成分股绑定的板块名**——
   * 原来的 map 写的是「新能源 / 光伏」，而 `BELONGS_TO` 用的是「电池 / 光伏设备」，
   * 信号落在了一个雷达根本不会评估的实体上。测试里钉死了这两个名字不许再出现。
   */
  sectors: string[];
};

/**
 * 20 个品种 → 板块。符号与板块名都在 2026-07-31 实测过：
 * 20/20 符号在 `hq.sinajs.cn` 有返回；所有板块名在 `BELONGS_TO` 里都有 ≥4 只成分股。
 */
export const COMMODITY_MAP: CommodityDef[] = [
  { sym: "nf_LC0", name: "碳酸锂", unit: "元/吨", sectors: ["电池", "能源金属"] },
  { sym: "nf_PS0", name: "多晶硅", unit: "元/吨", sectors: ["光伏设备"] },
  { sym: "nf_SI0", name: "工业硅", unit: "元/吨", sectors: ["小金属"] },
  { sym: "nf_CU0", name: "铜", unit: "元/吨", sectors: ["工业金属"] },
  { sym: "nf_AL0", name: "铝", unit: "元/吨", sectors: ["工业金属"] },
  { sym: "nf_NI0", name: "镍", unit: "元/吨", sectors: ["能源金属"] },
  { sym: "nf_AU0", name: "黄金", unit: "元/克", sectors: ["贵金属"] },
  { sym: "nf_AG0", name: "白银", unit: "元/千克", sectors: ["贵金属"] },
  { sym: "nf_RB0", name: "螺纹钢", unit: "元/吨", sectors: ["普钢"] },
  { sym: "nf_I0", name: "铁矿石", unit: "元/吨", sectors: ["普钢", "特钢"] },
  { sym: "nf_JM0", name: "焦煤", unit: "元/吨", sectors: ["焦炭", "煤炭开采"] },
  { sym: "nf_TA0", name: "PTA", unit: "元/吨", sectors: ["化学原料"] },
  { sym: "nf_MA0", name: "甲醇", unit: "元/吨", sectors: ["化学制品"] },
  { sym: "nf_PP0", name: "聚丙烯", unit: "元/吨", sectors: ["塑料"] },
  { sym: "nf_SA0", name: "纯碱", unit: "元/吨", sectors: ["化学制品", "玻璃玻纤"] },
  { sym: "nf_FG0", name: "玻璃", unit: "元/吨", sectors: ["玻璃玻纤"] },
  { sym: "nf_SC0", name: "原油", unit: "元/桶", sectors: ["炼化及贸易", "油气开采"] },
  { sym: "nf_PG0", name: "液化石油气", unit: "元/吨", sectors: ["燃气"] },
  { sym: "nf_C0", name: "玉米", unit: "元/吨", sectors: ["饲料", "农产品加工"] },
  { sym: "nf_M0", name: "豆粕", unit: "元/吨", sectors: ["饲料", "养殖业"] },
];

export const COMMODITY_SYMS = COMMODITY_MAP.map((c) => c.sym);

export type CommodityQuote = {
  sym: string;
  name: string;
  price: number;
  changePct: number;
};

/**
 * 新浪期货 `hq.sinajs.cn/list=` 响应（GBK 解码后的文本）→ 行情。
 * 字段位置：`[0]`名称 `[8]`最新价 `[10]`昨结算。昨结 ≤0 的行丢弃——
 * 除以 0 会得到 Infinity，然后一路变成"涨了无穷多"。
 */
export function parseSinaFutures(raw: string): CommodityQuote[] {
  const out: CommodityQuote[] = [];
  for (const line of raw.split("\n")) {
    const m = /hq_str_(nf_[A-Z0-9]+)="([^"]*)"/.exec(line);
    if (!m) continue;
    const sym = m[1]!;
    const f = m[2]!.split(",");
    const name = (f[0] ?? "").trim();
    const price = Number(f[8]);
    const prev = Number(f[10]);
    if (!name || !Number.isFinite(price) || !Number.isFinite(prev) || prev <= 0)
      continue;
    out.push({
      sym,
      name,
      price,
      changePct: ((price - prev) / prev) * 100,
    });
  }
  return out;
}

/** 自带链接的独立证据（不依赖站内 NewsItem）。 */
export type ExtraEvidence = {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string; // YYYY-MM-DD
  grade: CatalystGrade;
};

/** `nf_LC0` → 新浪期货行情页。 */
function quoteUrl(sym: string): string {
  return `https://finance.sina.com.cn/futures/quotes/${sym.replace(/^nf_/, "")}.shtml`;
}

/**
 * 一条商品行情 → 催化证据。变动不够大返回 `null`（不是催化，不要硬凑）。
 */
export function commodityEvidence(
  q: CommodityQuote,
  displayName: string,
  unit: string,
  day: string,
): ExtraEvidence | null {
  const abs = Math.abs(q.changePct);
  if (abs < MOVE_MEDIUM) return null;
  const dir = q.changePct > 0 ? "上涨" : "下跌";
  return {
    id: `commodity:${q.sym}:${day}`,
    title: `${displayName}期货${dir} ${abs.toFixed(1)}%，报 ${q.price}${unit}`,
    url: quoteUrl(q.sym),
    sourceName: "新浪期货·主力连续",
    publishedAt: day,
    grade: abs >= MOVE_HIGH ? "HIGH" : "MEDIUM",
  };
}

/** 合成 id 的前缀。落库时按它把商品证据与站内资讯主键分流。 */
export const COMMODITY_ID_PREFIX = "commodity:";

export function isCommodityId(id: string): boolean {
  return id.startsWith(COMMODITY_ID_PREFIX);
}

/**
 * 商品证据 → 引擎能直接吃的催化条目。
 *
 * 补齐 `CatalystNews` 需要的字段：`tier=PRIMARY`（期货结算价是交易所数据，
 * 不是谁的观点）、`boundCount=1`（它讲的就是这一个行业，不是绑了七八家的综述稿）。
 * `grade` 原样带过来——**不重新走 `gradeCatalyst`**，那套判据是给新闻标题写的，
 * 拿来判「碳酸锂期货上涨 3.4%」只会误伤。
 */
export function asGradedCatalyst(ev: ExtraEvidence): GradedCatalyst {
  return {
    id: ev.id,
    title: ev.title,
    sourceName: ev.sourceName,
    tier: "PRIMARY",
    url: ev.url,
    publishedAt: new Date(`${ev.publishedAt}T00:00:00.000Z`),
    importance: 70,
    eventType: "商品价格",
    boundCount: 1,
    grade: ev.grade,
  };
}
