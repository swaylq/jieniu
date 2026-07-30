// 证据抽屉的取数逻辑（张楚寒 2026-07-30）。相对导入、无 IO、可测。
//
// 反馈原话：「不建议点击后直接跳到外部新闻网站，会打断用户阅读。更适合点击整条『最新证据』，
// 在右侧打开一个证据抽屉」，抽屉里要有：**客观事实**、**为什么能验证该命题**、**影响判断**。
//
// 三段里只有前两段是存下来的（`ThesisSignal.fact` / `.why`）。第三段「影响判断」不需要新数据——
// 它就是**同一条资讯**在这家公司各个命题上留下的全部信号：命中了的按 6 级影响标注，
// 没命中的显式写「尚未验证」。这一点很重要：张楚寒的样例里「毛利率：尚未验证」是有信息量的，
// 它告诉用户「这条消息不能拿来说毛利率」，而这正是他批评现状时想要的诚实。

import { classifyLogicImpact, type LogicImpact } from "./logic-impact";
import {
  SOURCE_LEVEL_LABEL,
  isHardSource,
  type SourceLevel,
} from "./evidence-source";

export type EvidenceSignal = {
  dimensionKey: string;
  direction: string;
  materiality: number;
  fact: string;
  why: string;
  grade: string;
  newsTitle: string;
  newsId?: string | null;
  publishedAt?: Date | string | null;
  sourceName?: string | null;
  tier?: string | null;
  /** 六级来源等级。抽屉里的「证据强度」那一环靠它。 */
  sourceLevel?: SourceLevel;
};

export type EvidenceImpact = {
  dimensionKey: string;
  /** 命中了：6 级影响标签；没命中：「尚未验证」。 */
  label: string;
  tone: LogicImpact["tone"];
  touched: boolean;
};

export type EvidenceDetail = {
  newsTitle: string;
  newsId: string | null;
  /** 「公司公告 | 2026-07-17 | 一级来源」里的三段。 */
  sourceName: string;
  dateText: string;
  primary: boolean;
  fact: string;
  why: string;
  grade: string;
  /** 证据强度：来源等级 + 是否够格支撑「已验证」。 */
  strength: {
    level: SourceLevel;
    levelLabel: string;
    hard: boolean;
    /** 一句话说清这条证据能把命题推到哪一步。 */
    verdict: string;
  };
  impacts: EvidenceImpact[];
};

/** 日历日按**本地时区**取，别走 UTC（`toISOString()` 会把本地 8/15 00:30 写成 8/14）。 */
export function ymdLocal(d: Date | string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

const UNTESTED: Pick<EvidenceImpact, "label" | "tone"> = {
  label: "尚未验证",
  tone: "neutral",
};

/**
 * 组装一条证据的抽屉内容。
 *
 * @param target 被点开的那一条
 * @param all    这家公司**全部合格**的证据（用来找同一条资讯的其他维度影响）
 * @param dimKeys thesis 的全部命题 key，决定「影响判断」列出哪几行、以及谁标「尚未验证」
 */
export function buildEvidenceDetail(
  target: EvidenceSignal,
  all: EvidenceSignal[],
  dimKeys: string[],
): EvidenceDetail {
  // 同一条资讯的其他信号。newsId 缺失（老数据）时退回按标题匹配——
  // 宁可少关联也不要错关联，所以两者都不成立就只算 target 自己。
  const sameNews = all.filter((s) =>
    target.newsId ? s.newsId === target.newsId : s.newsTitle === target.newsTitle,
  );
  const byDim = new Map<string, EvidenceSignal>();
  for (const s of sameNews) {
    const cur = byDim.get(s.dimensionKey);
    if (!cur || s.materiality > cur.materiality) byDim.set(s.dimensionKey, s);
  }

  // 命题顺序以 thesis 为准；但这条资讯若触及了 thesis 之外的维度（用户改过命题），也补在后面，
  // 否则用户会看到一条证据挂着一个抽屉里根本不出现的命题。
  const keys = [...dimKeys];
  for (const k of byDim.keys()) if (!keys.includes(k)) keys.push(k);

  const impacts: EvidenceImpact[] = keys.map((k) => {
    const s = byDim.get(k);
    if (!s) return { dimensionKey: k, touched: false, ...UNTESTED };
    const im = classifyLogicImpact({
      direction: s.direction,
      materiality: s.materiality,
    });
    return { dimensionKey: k, touched: true, label: im.label, tone: im.tone };
  });

  // 证据强度（张楚寒第二轮）：来源等级 × 是否直接支持命题。两条都够才撑得起「已验证」。
  const level = target.sourceLevel ?? 4;
  const hard = isHardSource(level);
  const direct = target.grade === "direct";
  const verdict = hard
    ? direct
      ? "一至三级来源 + 直接支持命题 → 足以支撑「已验证」"
      : "来源够硬，但这条事实不是直接关于这家公司的 → 最多「部分验证」"
    : direct
      ? "直接关于这家公司，但来源是媒体/研报 → 最多「部分验证」"
      : "媒体/研报来源的旁证 → 只能作参考，不足以验证命题";

  return {
    newsTitle: target.newsTitle,
    newsId: target.newsId ?? null,
    sourceName: target.sourceName ?? "",
    dateText: ymdLocal(target.publishedAt),
    primary: target.tier === "PRIMARY",
    fact: target.fact,
    why: target.why,
    grade: target.grade,
    strength: {
      level,
      levelLabel: SOURCE_LEVEL_LABEL[level],
      hard,
      verdict,
    },
    impacts,
  };
}

/** 「公司公告 | 2026-07-17 | 一级来源」这一行。缺哪段就省哪段，不留空竖线。 */
export function sourceLine(d: Pick<EvidenceDetail, "sourceName" | "dateText" | "primary">): string {
  return [d.sourceName, d.dateText, d.primary ? "一级来源" : "媒体报道"]
    .filter((s) => s.length > 0)
    .join(" · ");
}
