// 自选股宇宙 seed 的纯逻辑（ZF-3 公司覆盖扩量）。

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
