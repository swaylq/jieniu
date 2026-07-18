// 热门股宇宙（张楚寒/GPT 反馈 2026-07-13：不必覆盖全部上市公司，先把最热门板块最火的
// 股票覆盖了——「A股热门的板块就那些，热门的股票可能也就一两百只」）。
//
// 纯数据 + 纯聚合，零 AI、零网络。板块 → 东方财富板块代码；成分股由 seed 脚本按市值 desc
// 抓前 cap 只（市值最大 ≈ 板块里「最火」的龙头），classify 进 SECTOR（BELONGS_TO）。

export type HotSector = {
  /** 板块名（与 DB SECTOR 实体名对齐；不存在则 seed 时创建）。 */
  name: string;
  /** 东方财富板块代码（成分股来源：clist fs=b:CODE，按 f20 市值 desc）。 */
  board: string;
  /** 纳入该板块的「最火」成分股数——按市值 desc 取前 cap 只。 */
  cap: number;
  /** 别名（对齐已有 SECTOR 实体 / 新闻标签）。 */
  aliases?: string[];
};

/**
 * curated：A股当前最热门的板块（张楚寒「热门的板块就那些」）。
 * Σcap ≈ 178（去重后唯一个股约一两百只，符合反馈的规模判断）。
 * 顺序即「重点覆盖」展示顺序（越靠前越核心的主线）。
 */
export const HOT_SECTORS: HotSector[] = [
  { name: "人工智能", board: "BK0800", cap: 16, aliases: ["AI", "大模型"] },
  { name: "算力", board: "BK1134", cap: 12, aliases: ["数据中心", "IDC"] },
  { name: "半导体", board: "BK0917", cap: 16, aliases: ["芯片", "集成电路"] },
  { name: "光模块", board: "BK1128", cap: 10, aliases: ["CPO"] },
  { name: "机器人", board: "BK1090", cap: 14, aliases: ["人形机器人"] },
  { name: "消费电子", board: "BK1646", cap: 12, aliases: ["3C"] },
  { name: "新能源", board: "BK0574", cap: 12, aliases: ["锂电池", "动力电池"] },
  { name: "光伏", board: "BK0588", cap: 10, aliases: ["太阳能"] },
  { name: "储能", board: "BK0989", cap: 10, aliases: [] },
  { name: "军工", board: "BK0490", cap: 12, aliases: ["国防"] },
  { name: "医药", board: "BK1106", cap: 12, aliases: ["创新药"] },
  { name: "汽车", board: "BK1211", cap: 12, aliases: ["整车", "新能源车"] },
  { name: "券商", board: "BK0473", cap: 10, aliases: ["证券"] },
  { name: "白酒", board: "BK0896", cap: 10, aliases: ["酿酒"] },
  { name: "银行", board: "BK1283", cap: 10, aliases: [] },
];

/** 去重前的「热门股宇宙」总额度（含跨板块重复个股）。 */
export const HOT_UNIVERSE_TARGET = HOT_SECTORS.reduce((s, x) => s + x.cap, 0);

export type HotStockRow = { ticker: string; name: string; sector: string };
export type DedupedHotStock = {
  ticker: string;
  name: string;
  /** 该股所属的全部热门板块（一只票可同属多板块，如芯片股同属半导体+算力）。 */
  sectors: string[];
  /** 首次出现的板块（即 HOT_SECTORS 中越靠前的主线），作展示归属。 */
  primarySector: string;
};

/**
 * 把跨板块的成分股去重：同一 ticker 只计一次，合并其所属板块，保留首个板块为 primary。
 * 用于统计「唯一热门股」规模（张楚寒关心的「一两百只」）与展示归属。
 */
export function dedupeHotStocks(rows: HotStockRow[]): DedupedHotStock[] {
  const map = new Map<string, DedupedHotStock>();
  for (const r of rows) {
    if (!r.ticker) continue;
    const cur = map.get(r.ticker);
    if (cur) {
      if (!cur.sectors.includes(r.sector)) cur.sectors.push(r.sector);
    } else {
      map.set(r.ticker, {
        ticker: r.ticker,
        name: r.name,
        sectors: [r.sector],
        primarySector: r.sector,
      });
    }
  }
  return [...map.values()];
}

/** curated 热门板块名集合——供 tRPC / UI 判断某板块是否属「重点覆盖」。 */
export const HOT_SECTOR_NAMES: string[] = HOT_SECTORS.map((s) => s.name);

/** 按 HOT_SECTORS 的 curated 顺序给板块名排序（未列入的排最后、保持稳定）。 */
export function hotSectorOrder(name: string): number {
  const i = HOT_SECTOR_NAMES.indexOf(name);
  return i === -1 ? HOT_SECTOR_NAMES.length : i;
}
