/** 归一化标题（只保留文字与数字，去标点/空白/括注），用于跨源判重。 */
export function normalizeTitle(title: string): string {
  return title.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

/**
 * 去掉东财式「公司名:」标题前缀（run7·跨源判重）。
 * 同一公告东财记作「恒力石化:恒力石化2026年半年度业绩预增公告」、巨潮记作「恒力石化2026年半年度业绩预增公告」，
 * 只按整标题判重会漏掉。去掉开头 2-12 字 + 冒号的前缀后，两者正文标题一致。
 */
export function stripEntityPrefix(title: string): string {
  return title.replace(/^[^:：\s]{2,12}[:：]/, "");
}

/**
 * 跨源判重 key：绑定实体集 + 去前缀后的正文标题。**必须带实体集**——否则不同公司的同名模板公告
 * （「关于重大资产重组的进展公告」）会被误并。仅对已绑定(entityIds 非空)的资讯用此 key。
 */
export function crossSourceKey(title: string, entityIds: string[]): string {
  return `${[...entityIds].sort().join(",")}::${normalizeTitle(stripEntityPrefix(title))}`;
}

/** 无价值 / 纯样板公告标题——入库时跳过，避免刷屏「最新」流。 */
const LOW_VALUE: RegExp[] = [
  /翌日披露报表/,
  /股票交易异常波动/,
  /召开.{0,8}股东大会/,
  /股东大会.{0,10}(通知|会议资料|决议)/,
];

export function isLowValueTitle(title: string): boolean {
  return LOW_VALUE.some((re) => re.test(title));
}
