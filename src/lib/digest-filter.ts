// 早报选材（张楚寒反馈）：退市/ST/风险警示"没人关注还不吉利"，别上头条；宏观大新闻(经济/政策/会议)该抬上来。

import { normalizeTitle, stripEntityPrefix } from "./dedupe";

/** 晦气/低关注：退市 / 风险警示 / 破产 / 终止上市 —— 不该占早报头条。 */
export const INAUSPICIOUS_KEYWORDS = [
  "退市",
  "风险警示",
  "终止上市",
  "面值退",
  "摘牌",
  "破产清算",
];

/** 宏观 / 市场级：经济环境、政策、重要会议——散户想在早报里看到的"大新闻"。 */
export const MACRO_KEYWORDS = [
  "经济",
  "政策",
  "央行",
  "发改委",
  "国常会",
  "国务院",
  "财政部",
  "货币政策",
  "降准",
  "降息",
  "LPR",
  "GDP",
  "PMI",
  "关税",
  "美联储",
  "北向资金",
  "数字经济",
  "大盘",
  "MSCI",
];

export function isInauspicious(title: string, eventType: string | null): boolean {
  if (eventType === "退市" || eventType === "破产") return true;
  if (INAUSPICIOUS_KEYWORDS.some((k) => title.includes(k))) return true;
  // ST / *ST 风险警示股（公司名前缀）
  if (/^\*?ST/.test(title.trim())) return true;
  return false;
}

export function isMacro(title: string): boolean {
  return MACRO_KEYWORDS.some((k) => title.includes(k));
}

export type DigestCandidate = {
  id: string;
  title: string;
  importance: number;
  eventType: string | null;
  publishedAt: Date;
  hasEntity: boolean;
  /** 绑定的覆盖 COMPANY/STOCK 实体 id（宏观/仅板块为空）——用于「每家公司在早报里最多几条」的同主体折叠。 */
  entityKeys: string[];
  source: { name: string };
};

/** 市场级宏观新闻：命中宏观关键词且不挂在具体个股上（个股新闻里带"经济"二字的不算）。 */
export function isMacroItem(c: DigestCandidate): boolean {
  return isMacro(c.title) && !c.hasEntity;
}

const MACRO_BOOST = 45;

/** 近重复判据下限：归一去前缀后的标题需 ≥ 此长度才做「互为子串」折叠，避免短标题误并。 */
const NEAR_DUP_MIN_LEN = 10;

/**
 * 同主体 / 近重复折叠（输入须已按展示优先级排好序，保序取前 take）：
 * - **每家覆盖公司最多 perCompany 条**——一家公司一次定增/重组会甩几十份程序性文档（「董事会关于本次交易符合《…》」），
 *   否则霸屏早报（实测精测电子曾占 12 条里的 6 条）。宏观/仅板块(entityKeys 空)不受此限。
 * - **近重复快讯碎片**——同一事件多条快讯，一条标题（去「机构:」前缀归一后）被另一条包含时，只留先到（分高/更新）的那条
 *   （如「结合一级交易商需求 研究逐步增加隔夜逆回购的操作频率」与「研究逐步增加隔夜逆回购的操作频率」）。不同政策点(互不包含)全保留。
 */
export function collapseDigestItems<
  T extends { title: string; entityKeys: string[] },
>(items: T[], take: number, perCompany = 1): T[] {
  const companyCount = new Map<string, number>();
  const keptNorms: string[] = [];
  const out: T[] = [];
  for (const it of items) {
    if (out.length >= take) break;
    // 同公司折叠：本条涉及的公司若都已达上限，跳过
    if (
      it.entityKeys.length > 0 &&
      it.entityKeys.every((k) => (companyCount.get(k) ?? 0) >= perCompany)
    ) {
      continue;
    }
    // 近重复折叠：与已留条目互为子串
    const norm = normalizeTitle(stripEntityPrefix(it.title));
    if (
      norm.length >= NEAR_DUP_MIN_LEN &&
      keptNorms.some((k) => k.includes(norm) || norm.includes(k))
    ) {
      continue;
    }
    out.push(it);
    for (const k of it.entityKeys)
      companyCount.set(k, (companyCount.get(k) ?? 0) + 1);
    if (norm.length >= NEAR_DUP_MIN_LEN) keptNorms.push(norm);
  }
  return out;
}

/** 早报排序：剔除晦气(退市/风险/破产)，宏观市场级新闻加权抬升，去重，按分数×时间排序后做同主体/近重复折叠取前 take。 */
export function rankDigest(
  cands: DigestCandidate[],
  take: number,
): (DigestCandidate & { macro: boolean })[] {
  const seen = new Set<string>();
  const sorted = cands
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return !isInauspicious(c.title, c.eventType);
    })
    .map((c) => ({ c, macro: isMacroItem(c) }))
    .map((x) => ({ ...x, score: x.c.importance + (x.macro ? MACRO_BOOST : 0) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.c.publishedAt.getTime() - a.c.publishedAt.getTime(),
    )
    .map((x) => ({ ...x.c, macro: x.macro }));
  return collapseDigestItems(sorted, take, 1);
}
