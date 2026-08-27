// 截图导入持仓的纯逻辑（2026-08-27）：名称交叉核对 + 合并补丁。纯函数，单测直接打。

/** 名称规整：去全部空白与星号（截图偶尔带 *ST 的星、全角空格），与 ensureStockEntities 的口径同族。 */
function squash(name: string): string {
  return name.replace(/[\s*＊]/g, "");
}

/**
 * 截图上的名字与行情返回的规范名是否「同一个东西」。
 * 完全相等或互含即算（截图可能写「贵州茅台」，行情返回「贵州茅台」；
 * 也可能截图带备注性后缀）。对不上 → 调用方把该行降级为「猜的」，让用户在确认表里过目——
 * 交叉核对是防「模型认错代码」的最后一道闸。
 */
export function namesRoughlyMatch(screenshotName: string, quoteName: string): boolean {
  const a = squash(screenshotName);
  const b = squash(quoteName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * 导入合并补丁：只含「截图里真有」的字段。
 *
 * 为什么不是全量写：`portfolio.upsert` 的 update 分支会把没传的字段一律置 null
 * （add-watch-sheet.tsx:161 的注释专门防过这个坑）——批量导入对已持仓的标的再来一次，
 * 等于把用户手录的成本价清掉。所以这里只写非 null 字段，已有的值一个不动。
 */
export function buildImportPatch(nums: {
  costBasis: number | null;
  shares: number | null;
}): { status: "HOLDING"; costBasis?: number; shares?: number } {
  const patch: { status: "HOLDING"; costBasis?: number; shares?: number } = { status: "HOLDING" };
  if (nums.costBasis != null) patch.costBasis = nums.costBasis;
  if (nums.shares != null) patch.shares = nums.shares;
  return patch;
}
