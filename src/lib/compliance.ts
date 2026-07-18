export type ComplianceHit = { label: string; match: string };

/**
 * 合规红线：AI 解读绝不能出现的表述。
 * 针对"荐股/买卖建议/点位预测/收益承诺"这些真正的监管红线，
 * 而非"买入/持有"等在阐述投资理念时的中性词（避免误伤价值投资科普）。
 */
const BANNED: { pattern: RegExp; label: string }[] = [
  {
    pattern:
      /(建议|推荐|应该|可以|值得|不妨|不如|务必|赶紧|立即|尽快|果断|现在就)\s*(买入|卖出|加仓|减仓|建仓|清仓|抄底|逃顶|买进|卖掉|购入)/,
    label: "买卖建议",
  },
  {
    pattern: /(买入|卖出|加仓|减仓|买进)\s*(时机|机会|信号|良机|区间|点位)/,
    label: "买卖建议",
  },
  { pattern: /满仓|全仓|梭哈|重仓买|all\s*in/i, label: "仓位指令" },
  {
    pattern:
      /目标价|目标位|看到\s*\d|涨到\s*\d|跌到\s*\d|冲高至|看高至|下探至|上看\s*\d|下看\s*\d/,
    label: "价格点位",
  },
  {
    pattern:
      /必涨|必跌|稳赚|包赚|翻[倍番]|保本|保证收益|稳健收益|躺赚|一定[涨赚跌]|无风险|稳健获利/,
    label: "收益承诺",
  },
];

/** 免责声明。 */
export const DISCLAIMER =
  "本内容由 AI 基于公开信息生成，仅供信息参考与投资者教育，不构成任何投资建议。市场有风险，决策需谨慎。";

/** 扫描文本，返回命中的合规红线项。 */
export function scanCompliance(text: string): ComplianceHit[] {
  const hits: ComplianceHit[] = [];
  for (const { pattern, label } of BANNED) {
    const m = pattern.exec(text);
    if (m) hits.push({ label, match: m[0] });
  }
  return hits;
}

export function isCompliant(text: string): boolean {
  return scanCompliance(text).length === 0;
}

/** 附上免责声明（幂等，已含则不重复）。 */
export function withDisclaimer(text: string): string {
  if (text.includes(DISCLAIMER)) return text;
  return `${text}\n\n—— ${DISCLAIMER}`;
}
