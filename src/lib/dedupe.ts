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

/**
 * 历史回填判重 key：跨源 key **再加发布日**。
 *
 * 回填一年不能只按标题判重——「关于回购公司股份进展的公告」同一家公司一年要发十几次，
 * 标题一字不差；按标题去重会把十几个真实事件删成一个。而同一份公告在两个源里
 * （东财 art_code / 巨潮 adjunctUrl，hash 不同）发布日是一致的，所以「实体+标题+发布日」
 * 既杀得掉跨源重复，又保得住同名的周期性事件。
 */
export function historicalKey(
  title: string,
  entityIds: string[],
  publishedAt: Date,
): string {
  const day = Number.isNaN(publishedAt.getTime())
    ? "?"
    : publishedAt.toISOString().slice(0, 10);
  return `${crossSourceKey(title, entityIds)}::${day}`;
}

/** 已入库的同名公告：发布时刻 + 来源。 */
export type PriorFiling = { publishedAt: Date; sourceKey: string };

/**
 * 跨源同一份公告的允许日期误差（天）。
 *
 * 东财记 `notice_date`（官方公告日），巨潮记 `announcementTime`（实际披露时刻），
 * 晚间披露会跨天——同一份公告两个源常差 1 天。实测因此漏判 697 组。
 */
export const CROSS_SOURCE_DAY_TOLERANCE = 2;

/**
 * 这条公告是否只是**另一个源**里已有那份的重复。
 *
 * 刻意只并跨源：同一个源里出现两条同名公告（恒瑞一周内两次「获得药物临床试验批准通知书」）
 * 更可能是两件真事，日期再近也不并——那种情况本来就有 hash 兜底防重复入库。
 */
export function isCrossSourceRepeat(
  priors: PriorFiling[],
  publishedAt: Date,
  sourceKey: string,
): boolean {
  if (Number.isNaN(publishedAt.getTime())) return false;
  return priors.some((p) => {
    if (p.sourceKey === sourceKey) return false;
    if (Number.isNaN(p.publishedAt.getTime())) return false;
    const gapDays =
      Math.abs(p.publishedAt.getTime() - publishedAt.getTime()) / 86_400_000;
    return gapDays <= CROSS_SOURCE_DAY_TOLERANCE;
  });
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
