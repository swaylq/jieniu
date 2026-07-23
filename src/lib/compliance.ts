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

/**
 * 券商研报标题里的「评级/目标价」表述（铁律②：不荐股、不喊价）。
 *
 * 解牛收录研报是当作**事件**（谁、什么时候、发了什么主题的研报），不是当作推荐。
 * 因此评级字段（emRatingName / indvAimPrice…）一律不入库，标题命中评级语言的整条丢弃。
 * 刻意**不**拦单独出现的「增持/减持」——「大股东增持彰显信心」是真实事件而非评级，
 * 只拦「维持/上调/下调/首次 + 增持/推荐/持有/减持」这种明确的评级动作。
 */
const RATING_HEADLINE =
  /评级|目标价|买入|强烈推荐|谨慎推荐|跑赢(行业|大市)|优于大市|(维持|上调|下调|首次)\s*(增持|推荐|持有|减持)/;

/** 研报标题是否含评级/目标价表述（含则不收录）。 */
export function isRatingHeadline(title: string): boolean {
  return RATING_HEADLINE.test(title);
}

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
