/**
 * 机会雷达（P5-4）——ChatGPT 批评：发现页现在是 501 家公司的静态目录，用户不会为浏览目录持续使用；
 * 应改成「发现机会」。诚实约束：价格类机会（进入买点/估值便宜/风险收益改善）需数值行情（P4-10，暂缺）
 * 不假装；逻辑类机会需近期 thesis 信号（当前为 0）暂空。**本轮做数据充足、纯规则、零 AI 的一类**：
 * 近期资讯热度 × 新信息程度——把「高关注但多为跟进报道」（ChatGPT 的『高关注度、低新信息』）和
 * 「有原始新进展」区分开，帮用户在噪声里找到真正有新事实的标的。
 *
 * 颜色遵守铁律：红/绿只给真实价格。此处 amber=有原始进展、灰=多为跟进/热度升温。
 */
export type AttentionRow = {
  entityId: string;
  name: string;
  ticker: string | null;
  type: string;
  total: number; // 近期资讯总数
  primary: number; // 其中一手/原始(PRIMARY)条数
};

export type RadarItem = {
  entityId: string;
  name: string;
  ticker: string | null;
  total: number;
  primary: number;
  primaryShare: number; // 0..1，一手占比
  lowNovelty: boolean; // 高关注但新信息少
  flagLabel: string;
  flagTone: "up" | "neutral";
  hint: string;
};

/** 够“热”的下限：低于此资讯量不算“受关注”，不进雷达（宁缺毋滥）。 */
export const RADAR_MIN_TOTAL = 3;
/** 一手占比低于此值 = “高关注低新信息”（多为跟进/转述）。 */
export const LOW_NOVELTY_SHARE = 0.34;
/** 一手占比高于此值 = “有原始新进展”，值得细看。 */
export const FRESH_SHARE = 0.5;

export function rankAttentionRadar(
  rows: AttentionRow[],
  take: number,
): RadarItem[] {
  return rows
    .filter((r) => r.total >= RADAR_MIN_TOTAL)
    .map((r): RadarItem => {
      const share = r.total > 0 ? r.primary / r.total : 0;
      const lowNovelty = share < LOW_NOVELTY_SHARE;
      let flagLabel: string;
      let flagTone: "up" | "neutral";
      let hint: string;
      if (share >= FRESH_SHARE) {
        flagLabel = "有原始进展";
        flagTone = "up";
        hint = "近期有较多一手信息，值得细看是否触及你的逻辑。";
      } else if (lowNovelty) {
        flagLabel = "多为跟进报道";
        flagTone = "neutral";
        hint = "关注度高但新增事实有限，留意是否被情绪推动。";
      } else {
        flagLabel = "关注升温";
        flagTone = "neutral";
        hint = "近期资讯量上升，一手与跟进参半。";
      }
      return {
        entityId: r.entityId,
        name: r.name,
        ticker: r.ticker,
        total: r.total,
        primary: r.primary,
        primaryShare: share,
        lowNovelty,
        flagLabel,
        flagTone,
        hint,
      };
    })
    .sort((a, b) => b.total - a.total || b.primaryShare - a.primaryShare)
    .slice(0, take);
}
