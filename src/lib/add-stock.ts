// 自助加股（backlog #4）的纯逻辑：把用户搜索词分类为「代码 / 名称 / 无效」，并规整股票名。
// 注意用相对导入（脚本走 tsx，不解析 ~ 别名）。

import { tickerToSymbol } from "./quote";

export type StockQuery =
  | { kind: "code"; code: string }
  | { kind: "name"; name: string }
  | { kind: "invalid" };

/**
 * 分类用户的加股搜索词：
 * - 6 位数字且是可识别的 A 股代码前缀（tickerToSymbol 非空：6/0/3/8/4 开头）→ code
 * - 6 位数字但非 A 股前缀（如 1/2/5/9 开头的债/基/权证）→ invalid
 * - 其它非空且非纯数字文本 → name（交给东财 suggest 解析成代码）
 * - 空 / 非 6 位纯数字 → invalid
 */
export function classifyStockQuery(raw: string): StockQuery {
  const q = raw.trim();
  if (q.length === 0) return { kind: "invalid" };
  if (/^\d{6}$/.test(q)) {
    return tickerToSymbol(q) ? { kind: "code", code: q } : { kind: "invalid" };
  }
  // 纯数字但不是 6 位（4 位板块代码 / 7 位等）→ 不像 A 股个股代码，也不当名字去搜
  if (/^\d+$/.test(q)) return { kind: "invalid" };
  return { kind: "name", name: q };
}

/** 股票名规整：去掉所有空白（与 add-stocks.ts / ensureStockEntities 保持一致）。 */
export function normalizeStockName(raw: string): string {
  return raw.replace(/\s+/g, "");
}
