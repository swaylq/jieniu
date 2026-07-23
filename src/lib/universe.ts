// 自选股宇宙 seed 的纯逻辑（ZF-3 公司覆盖扩量）。

/**
 * 交易所临时证券简称前缀：XD=除息、XR=除权、DR=除权除息（当日挂牌名会被行情源改写）。
 *
 * 危害：seed 若在除权除息日跑，抓到的名字是「XD华电新」——**既带前缀、又被截断**
 * （真名「华电新能」被挤掉一个字）。后果有三：
 *   ① 按名字找不到已有公司 → **新建一个重复公司**；
 *   ② 该实体进了匹配词典，而资讯正文写的是「华电新能」→ 永远绑不上 → 公司页全空；
 *   ③ 用户搜真名搜不到。
 *
 * 关键：**这一天所有行情源都返回带前缀的名字**，没法当场还原真名（截断的字补不回来），
 * 所以正确做法不是"去掉前缀"（会得到「华电新」这个错名），而是**当天别用这个名字建实体**，
 * 留到次日正常名再建；已被污染的存量由 `fix-prefixed-names.ts` 每日自愈。
 */
const TEMP_PREFIX = /^(XD|XR|DR)[一-龥]/;

/** 名字是否带交易所临时前缀（除权除息日的挂牌简称）。带前缀的名字不可信、不能拿来建实体。 */
export function hasTempPrefix(name: string): boolean {
  return TEMP_PREFIX.test(name.trim());
}

export function exchangeFromCode(code: string): "SH" | "SZ" | "BJ" {
  const h = code[0];
  if (h === "6") return "SH";
  if (h === "8" || h === "4") return "BJ";
  return "SZ";
}

/**
 * 是否值得进自选股宇宙：剔除非个股(ETF/指数/基金/REIT/LOF)与风险警示/退市股
 * （ST/*ST 前缀、名称以"退"结尾）——张楚寒:"退市的没几个人关注还不吉利"。
 */
export function isSeedableStock(name: string): boolean {
  if (/ETF|指数|基金|REIT|LOF/i.test(name)) return false;
  if (/^\*?ST/.test(name.trim())) return false;
  if (name.trim().endsWith("退")) return false;
  return true;
}

// 退市流程类公告标题——关注的人根本没有（张楚寒 2026-07-13），不必爬。
// 只用「股票退市」专属措辞：不含「终止上市 / 摘牌」——那俩也用于可转债到期兑付摘牌（正常公司的正常公司行为，别误杀）。
const DELISTING_TITLE = /退市整理|进入退市|退市风险提示|暂停上市/;

/**
 * 是否「退市噪声」公告：ST/*ST/退 个股（或 ETF/指数等非个股）发的、或退市流程类标题的公告。
 * 用于 ingest 源头过滤（不入库）+ 存量清理。张楚寒：「这种新闻关注的人根本没有，不需要爬过来」。
 */
export function isDelistingNoise(name: string, title: string): boolean {
  if (!isSeedableStock(name)) return true; // ST/*ST/退/ETF/指数/基金…
  return DELISTING_TITLE.test(title);
}
