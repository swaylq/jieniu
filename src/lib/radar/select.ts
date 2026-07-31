/**
 * 入选与配额（需求 §1 每日上限 / §5 基础过滤）——纯函数、无 IO、可测。
 *
 * 核心态度：**宁可少给，不降标准凑数**。需求原文「如果没有符合要求的信号，
 * 直接显示：今日暂无高置信度的新机会。不得为了填满页面降低标准」——所以这里
 * 所有函数都允许返回空，空不是 bug。
 */

/** 每天最多几个行业信号。 */
export const MAX_SECTORS = 3;
/** 每个行业最多几只代表性个股。 */
export const MAX_STOCKS_PER_SECTOR = 2;
/** 全部机会总数上限。 */
export const MAX_TOTAL = 8;
/** 过去 20 日平均成交额下限（元）。 */
export const MIN_AVG_AMOUNT_20 = 1e8;
/** 上市时长下限（交易日）。我们只取 60 日窗口，留 5 天余量给缺日/临时停牌。 */
export const MIN_BARS = 55;

export type StockBasics = {
  name: string;
  /** 60 日窗口里实际拿到的交易日数 */
  barCount: number;
  /** 过去 20 日平均成交额（元） */
  avgAmount20: number | null;
  suspended: boolean;
  oneWordLimitUp: boolean;
  /** 收盘价跳变与涨跌幅对不上 = 除权/复牌类机械异动 */
  priceGapAnomaly: boolean;
};

/**
 * ST 判定用**中文语境**的形态，不是裸子串 "ST"——
 * 「TCL科技」「STO顺丰控股」这类含 ST 字母的正常公司不能被误杀。
 * 真实 A 股的风险警示名一律是 `ST`/`*ST` 开头 + 中文，或含「退市」「退」结尾。
 */
const ST_NAME = /^\*?ST[一-龥]|^退市|退\(\d{6}\)$/;

export function baseFilter(b: StockBasics): { ok: boolean; reason?: string } {
  if (ST_NAME.test(b.name.trim()))
    return { ok: false, reason: "ST / 退市整理股" };
  if (b.suspended) return { ok: false, reason: "停牌" };
  if (b.oneWordLimitUp) return { ok: false, reason: "一字涨停（买不到）" };
  if (b.priceGapAnomaly)
    return { ok: false, reason: "除权/复牌类机械异动，行情不可比" };
  if (b.barCount < MIN_BARS)
    return { ok: false, reason: "上市不足 60 个交易日" };
  if (b.avgAmount20 === null || b.avgAmount20 < MIN_AVG_AMOUNT_20)
    return { ok: false, reason: "20 日均成交额不足 1 亿" };
  return { ok: true };
}

export type SectorPick = { key: string; sector: string; score: number };
export type StockPick = {
  key: string;
  ticker: string;
  sector: string;
  score: number;
  /**
   * 同一家公司的另一半实体（COMPANY↔STOCK 是孪生的）。用它做去重键，
   * 库层的 `OpportunitySignal.dedupeKey` 唯一约束是第二道闸。
   */
  companyKey?: string;
  /** 逆势走强：按定义就长在弱势（未入选）行业里，是"个股从入选行业里挑"的唯一例外 */
  fromUnselectedSector?: boolean;
};

/**
 * 按配额取最终清单。
 *
 * 顺序是有意的：**行业先占位**——行业信号是"哪条线在动"的答案，个股只是它的代表；
 * 总额度用完时该砍的是第 N 只个股，不是第 3 个行业。
 */
export function selectOpportunities<S extends SectorPick, T extends StockPick>(
  sectors: S[],
  stocks: T[],
): { sectors: S[]; stocks: T[] } {
  const pickedSectors = [...sectors]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SECTORS);
  const inPlay = new Set(pickedSectors.map((s) => s.sector));

  const perSector = new Map<string, number>();
  const seen = new Set<string>();
  const pickedStocks: T[] = [];

  /**
   * 排序里 `fromUnselectedSector` 排在分数**前面**：需求 §5 说「个股原则上从已经入选的
   * 行业中选择」，所以入选行业的代表股先占位，逆势走强只补剩余名额。
   * 实跑第一版没有这条时，5 个个股位全被逆势走强占了——因为「跑赢行业 12 个百分点」
   * 天然比「跟着强势行业一起涨」得分高，强势行业反而一只代表股都露不出来。
   */
  const ordered = [...stocks].sort(
    (a, b) =>
      Number(a.fromUnselectedSector ?? false) -
        Number(b.fromUnselectedSector ?? false) || b.score - a.score,
  );
  for (const s of ordered) {
    if (pickedSectors.length + pickedStocks.length >= MAX_TOTAL) break;
    // 个股原则上从已入选行业里挑；逆势走强是唯一例外
    if (!inPlay.has(s.sector) && !s.fromUnselectedSector) continue;
    const n = perSector.get(s.sector) ?? 0;
    if (n >= MAX_STOCKS_PER_SECTOR) continue;
    // 同一家公司只出现一次（ticker 或孪生实体键任一撞上就算重复）
    if (seen.has(s.key)) continue;
    if (s.companyKey && seen.has(s.companyKey)) continue;
    seen.add(s.key);
    if (s.companyKey) seen.add(s.companyKey);
    perSector.set(s.sector, n + 1);
    pickedStocks.push(s);
  }

  return { sectors: pickedSectors, stocks: pickedStocks };
}
