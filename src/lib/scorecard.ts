/**
 * 资讯记分卡（灵感：Koyfin 0–100 分位记分卡的**合规改写**）。
 *
 * 维度全部是关于「资讯覆盖 / 关注度」的客观统计，**不是价格/估值，更不是评级或涨跌预测**：
 *  - 资讯热度：近 30 日资讯量在全站实体中的分位
 *  - 重磅密度：近 30 日资讯里重磅(importance≥阈值)的占比
 *  - 多视角相关：4 位大师视角里"经常相关"的数量占比
 * 视觉用琥珀/灰阶（红绿只留给真实价格涨跌）。
 */

export type ScorecardLevel = "高" | "中" | "低";
export type ScorecardEntry = {
  key: string;
  label: string;
  score: number; // 0-100
  note: string;
  level: ScorecardLevel;
};
export type Scorecard = { entries: ScorecardEntry[]; headline: string };

export function levelOf(score: number): ScorecardLevel {
  if (score >= 67) return "高";
  if (score >= 34) return "中";
  return "低";
}

/** 分位：`all` 中 ≤ value 的比例（0-100）。空集回退 0。 */
export function percentileRank(value: number, all: number[]): number {
  if (all.length === 0) return 0;
  const le = all.filter((v) => v <= value).length;
  return Math.round((le / all.length) * 100);
}

export type ScorecardInput = {
  news30d: number;
  hot30d: number;
  peerNews30d: number[]; // 全站各实体近 30 日资讯量（含本实体）
  focusMasters: number; // 0-4：经常相关的大师视角数
};

export function buildScorecard(input: ScorecardInput): Scorecard {
  const heat = percentileRank(input.news30d, input.peerNews30d);
  const hotShare =
    input.news30d > 0 ? Math.round((input.hot30d / input.news30d) * 100) : 0;
  const focus = Math.round((input.focusMasters / 4) * 100);

  const entries: ScorecardEntry[] = [
    {
      key: "heat",
      label: "资讯热度",
      score: heat,
      note: `近 30 日 ${input.news30d} 条`,
      level: levelOf(heat),
    },
    {
      key: "hot",
      label: "重磅密度",
      score: hotShare,
      note: `${input.hot30d} 条重磅`,
      level: levelOf(hotShare),
    },
    {
      key: "focus",
      label: "多视角相关",
      score: focus,
      note: `${input.focusMasters}/4 大师视角常相关`,
      level: levelOf(focus),
    },
  ];

  const strong = entries.filter((e) => e.level === "高").map((e) => e.label);
  const headline =
    input.news30d === 0
      ? "近 30 日暂无资讯覆盖"
      : strong.length > 0
        ? `资讯活跃 · ${strong.join("、")}突出`
        : "资讯覆盖平稳";

  return { entries, headline };
}
