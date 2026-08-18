// 媒体转载折叠（sway 2026-08-18 直报：「首页的新闻几条都是不同渠道的频准激光上市的新闻，但是内容都一样」）。
//
// 现场：国盾量子(688027) 个股页「资讯」tab，最新 14 条里 13 条是同一件事——频准激光 688826 上市首日
// 暴涨。同一篇通稿被十几家媒体转发，东财个股资讯把每一家都收了一条：
//   · 【金融投资报】A股最大“肉签”诞生！频准激光 (688826)上市首日最高涨幅595.6%…
//   · 【消费日报财经】A股年内最贵新股688826今日上市，大涨逾500%，中一签赚超45万
//   · 【金融投资网】A股最大“肉签”诞生！中一签最高赚55.65万元
//   · 【新华财经】/【21世纪经济报道】/【中国证券报】/【券商中国】…
// 三条标题各写各的，正文摘要一字不差。
//
// 既有的两道去重都够不着这一档：
//   · `dedupe.ts` 的 `crossSourceKey` 按**整标题**判重——转载稿标题各家自己重拟，一条都不重合；
//     且它刻意只并**跨源**（同源同名更可能是两件真事），而这十几条源 key 全是 eastmoney-stocknews。
//   · `event-cluster.ts` 的 `clusterNews` 按标题相似度 ≥0.5 聚簇——实测这组两两相似度 0.15~0.45，
//     全在阈值下（而且 NewsEvent 聚类脚本压根没挂进调度器，近 7 天 eventId 覆盖 0 条）。
//
// 转载的稳定特征不在标题，在**正文**：各家改标题、不改稿。所以这里按「去掉媒体署名后的摘要」判重，
// 标题近乎一致（只差标点）作为补充信号。
//
// 尺度是**宁缺毋滥**：折错一条 = 把一件真事藏起来，比多显示一条重复贵得多。因此
//   · 只折媒体稿（MEDIA）。一手公告有自己的 `collapseAnnouncementBursts`，一手永远不折进转载堆。
//   · 摘要太短不拿来判重（见 REPRINT_BODY_MIN）——「2026年一季度，赣锋锂业实现收入91.96亿元，
//     归母净利润18.37亿元。」这种财务样板句会出现在同一家公司完全不同的两件事里，实测按它判重
//     会把「申请交割厂库资质」和「拟出资1亿元认购合伙企业」误并成一条。
//   · 代表条优先选**标题点到主体、且不是早报/汇总体裁**的那条——一组里混着早报时，
//     露出来的必须是「万华化学：烟台产业园MDI装置停产检修」，不能是「今天，宇树科技IPO，迎来关键节点」。
//
// 实测（400 只股 × 各取最近 40 条 = 16000 条）：折叠 233 条、1.5%。绝大多数个股一条都不折——
// 转载刷屏是长尾事件，只在出大新闻那天砸下来，正好是用户会看的那天。

import { charBigrams, jaccard } from "./event-cluster";
import { isRoundupGenre } from "./evidence";
import { titleNamesSubject, type SubjectEntity } from "./news-subject";

/** 同一篇稿的转载窗：各家转发多在当天，隔夜再转也有（早报把昨天的稿再登一次）。 */
export const REPRINT_WINDOW_HOURS = 48;

/**
 * 摘要归一化后至少这么长，才够格拿来判「同一篇稿」。
 *
 * 库里的 summary 是正文前 128 字截断，短摘要常常是财务样板句或一句话导语——同一家公司的
 * 不同事件会共用它。40 字是实测拐点：再低就开始把赣锋锂业那种两件真事误并。
 */
export const REPRINT_BODY_MIN = 40;

/** 正文（摘要）判重阈值：字符二元组 Jaccard。转载稿实测 0.85~1.0，改写稿在 0.5 以下。 */
export const REPRINT_BODY_SIM = 0.75;

/** 标题判重阈值：只兜「同稿同标题、只差标点」这一档（『开盘暴涨超595%！中一签赚逾55万元！』vs『开盘，暴涨超595%！中一签，狂赚逾55万元！』）。 */
export const REPRINT_TITLE_SIM = 0.62;

/**
 * 剥掉摘要开头的媒体署名：「【金融投资报】具体来看，…」→「具体来看，…」。
 * 东财个股资讯给每条转载都盖上转发媒体的名字，不剥就等于给每条加了一段各不相同的前缀，
 * 摘要相似度被拉低（实测同一篇稿因此从 0.95 掉到 0.80 上下，靠近阈值线）。
 */
export function stripOutletTag(summary: string): string {
  return summary.replace(
    /^\s*[【[（(]([^】\]）)]{1,20})[】\]）)]\s*[，,。：:]?\s*/u,
    "",
  );
}

/**
 * 免责/风险提示句——判重前整句丢掉。
 *
 * 东财「调研快报」这一档的 summary 从头到尾就是同一段免责声明（「东方财富发布此内容旨在传播
 * 更多信息，与本平台立场无关。东方财富力求但不保证数据的完全准确…」），28 家不同公司的机构调研
 * 记录正文一字不差。不剥掉的话它们会被判成「同一篇稿的 28 次转载」——卡片上写「另有 27 家媒体
 * 转发同一篇稿」，而那是**28 件不同的事**，是句假话。
 */
const DISCLAIMER_SENTENCE =
  /旨在传播更多信息|与本平台立场无关|力求但不保证|信息披露媒体为准|不构成投资建议|不构成任何投资建议|据此操作.{0,8}风险自担|投资者据此操作|市场有风险/;

/** 判重用的归一化：剥署名 → 丢免责句 → 去标点/空白 → 小写。 */
function bodyText(summary: string): string {
  return stripOutletTag(summary)
    .split(/(?<=[。；;!！?？])/u)
    .filter((s) => !DISCLAIMER_SENTENCE.test(s))
    .join("")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
}

export type ReprintItem = {
  id: string;
  title: string;
  summary: string;
  /** SourceTier：只有 MEDIA 参与折叠 */
  tier: string;
  importance: number;
  publishedAt: Date;
};

type Prepped<T> = {
  it: T;
  titleGrams: Set<string>;
  bodyGrams: Set<string>;
  bodyLen: number;
};

function prep<T extends ReprintItem>(it: T): Prepped<T> {
  const body = bodyText(it.summary);
  return {
    it,
    titleGrams: charBigrams(it.title),
    bodyGrams: charBigrams(body),
    bodyLen: body.length,
  };
}

/** 两条媒体稿是不是同一篇的不同转载：时间窗内 + （正文近乎一致 或 标题近乎一致）。 */
function isReprintPair<T extends ReprintItem>(
  a: Prepped<T>,
  b: Prepped<T>,
  windowMs: number,
): boolean {
  const gap = Math.abs(
    a.it.publishedAt.getTime() - b.it.publishedAt.getTime(),
  );
  if (!Number.isFinite(gap) || gap > windowMs) return false;
  const bodyComparable =
    a.bodyLen >= REPRINT_BODY_MIN && b.bodyLen >= REPRINT_BODY_MIN;
  if (bodyComparable && jaccard(a.bodyGrams, b.bodyGrams) >= REPRINT_BODY_SIM) {
    return true;
  }
  return jaccard(a.titleGrams, b.titleGrams) >= REPRINT_TITLE_SIM;
}

/**
 * 一簇转载里挑代表：标题点到主体的优先 → 非早报/汇总体裁优先 → 重要性高 → 最新。
 *
 * 前两条是这个函数存在的理由。一簇里常常混进一篇早报（早报正文里也抄了同一段），
 * 若按「最新」或「最重要」随手选，露出来的会是「界面晚报 | 体育强国建设…」，
 * 而真正说清这件事的那条被折进「另有 N 篇」里——用户等于什么都没看到。
 */
function pickRepresentative<T extends ReprintItem>(
  group: Prepped<T>[],
  subject?: SubjectEntity | null,
): T {
  const rank = (x: T): number => {
    const named = subject ? titleNamesSubject(x.title, subject) : true;
    const roundup = isRoundupGenre(x.title);
    return (named ? 0 : 2) + (roundup ? 1 : 0);
  };
  const sorted = [...group].sort((a, b) => {
    const ra = rank(a.it);
    const rb = rank(b.it);
    if (ra !== rb) return ra - rb;
    if (b.it.importance !== a.it.importance) {
      return b.it.importance - a.it.importance;
    }
    return b.it.publishedAt.getTime() - a.it.publishedAt.getTime();
  });
  return sorted[0]!.it;
}

export type ReprintGroup<T> = {
  /** 露出来的那条 */
  representative: T;
  /** 簇内全部成员（含代表），按输入顺序 */
  members: T[];
};

/**
 * 把一串资讯聚成「同一篇稿」的簇。折叠与巡检共用这一层。
 *
 * 贪心聚簇，与簇内**任一**成员构成转载对即入簇（转载链上 A≈B、B≈C 时 A、C 也是同一篇稿）。
 * 簇按首次出现顺序入列，输出保序；非 MEDIA（一手公告 / 衍生研报）各自单独成簇、永不合并。
 * 输入顺序不影响判重（时间窗是两两比对），只决定簇占哪个位置。
 *
 * `subject` 给了就用来挑代表（个股页传本页那只股）；不给则退回「非早报 → 重要性 → 最新」。
 */
export function groupReprints<T extends ReprintItem>(
  items: T[],
  subject?: SubjectEntity | null,
  windowHours = REPRINT_WINDOW_HOURS,
): ReprintGroup<T>[] {
  const windowMs = windowHours * 60 * 60 * 1000;
  const clusters: { foldable: boolean; members: Prepped<T>[] }[] = [];
  for (const raw of items) {
    const p = prep(raw);
    if (raw.tier !== "MEDIA") {
      clusters.push({ foldable: false, members: [p] });
      continue;
    }
    const hit = clusters.find(
      (c) => c.foldable && c.members.some((m) => isReprintPair(m, p, windowMs)),
    );
    if (hit) hit.members.push(p);
    else clusters.push({ foldable: true, members: [p] });
  }
  return clusters.map((c) => ({
    representative:
      c.members.length === 1
        ? c.members[0]!.it
        : pickRepresentative(c.members, subject),
    members: c.members.map((m) => m.it),
  }));
}

/**
 * 折叠媒体转载：同一篇稿的多家转发只留一条代表，`reprintCount` = 被折掉的份数。
 * 代表落在**该簇第一条出现的位置**（输入按时间倒序时 = 最新那条的位置），输出保序。
 */
export function collapseReprints<T extends ReprintItem>(
  items: T[],
  subject?: SubjectEntity | null,
  windowHours = REPRINT_WINDOW_HOURS,
): (T & { reprintCount: number })[] {
  return groupReprints(items, subject, windowHours).map((g) => ({
    ...g.representative,
    reprintCount: g.members.length - 1,
  }));
}
