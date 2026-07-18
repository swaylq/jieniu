import type { SourceTier } from "../../generated/prisma";

/**
 * 新信息程度（Novelty）——回答 ChatGPT 批评的核心问题之一：
 * 「哪些只是重复报道？哪些是原始新事实？」。纯规则、零 AI（省 token 铁律）：
 * 由来源等级 SourceTier + 同事件文章数（event 合并簇大小）推导，不编造数字。
 *
 * 分级（高→低新信息量）：
 *  - fresh      原始信息   一手来源（PRIMARY），可能含新事实
 *  - follow     跟进报道   多家媒体转述同一事件（簇>1），新增信息有限 ← 用户可略读
 *  - coverage   媒体报道   单篇媒体转述，非一手
 *  - commentary 评论解读   衍生观点 / 分析，非新增事实
 *
 * 颜色遵守铁律：红/绿只给真实价格；此处高新信息用 amber，低的用灰，帮用户略过噪声。
 */
export type NoveltyLevel = "fresh" | "follow" | "coverage" | "commentary";

export type Novelty = {
  level: NoveltyLevel;
  label: string;
  hint: string;
  /** UI 语气：strong=值得看（amber），weak=可略读（灰） */
  tone: "strong" | "weak";
};

const NOVELTY: Record<NoveltyLevel, Omit<Novelty, "level">> = {
  fresh: {
    label: "原始信息",
    hint: "一手来源，可能含新事实",
    tone: "strong",
  },
  follow: {
    label: "跟进报道",
    hint: "多家媒体报道同一事件，新增信息有限",
    tone: "weak",
  },
  coverage: {
    label: "媒体报道",
    hint: "媒体转述，非一手来源",
    tone: "weak",
  },
  commentary: {
    label: "评论解读",
    hint: "观点 / 分析，非新增事实",
    tone: "weak",
  },
};

export function classifyNovelty(input: {
  tier: SourceTier;
  /** 同事件文章数（event.count / 合并簇大小），默认 1 */
  clusterCount?: number | null;
}): Novelty {
  const count = input.clusterCount ?? 1;
  let level: NoveltyLevel;
  if (input.tier === "PRIMARY") {
    // 一手来源 = 原始新事实（即便被多家跟进，第一手仍是新信息）
    level = "fresh";
  } else if (input.tier === "DERIVED") {
    level = "commentary";
  } else if (count > 1) {
    // 媒体 + 同事件多篇 = 跟进 / 重复报道
    level = "follow";
  } else {
    level = "coverage";
  }
  return { level, ...NOVELTY[level] };
}
