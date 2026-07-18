/**
 * 大师共识罗盘（灵感：Seeking Alpha 三方评级同轴并置）。
 *
 * 把 4 位投资大师放在同一条「视角契合度」坐标上，衡量各投资哲学与这条资讯的相关度——
 * 一眼看出「多视角一致关注」还是「只有某个视角关心」。
 *
 * 合规红线：这是**描述性**的"哪种投资框架更贴合这条资讯"，
 * **不是评级、不是好坏、更不是涨跌/买卖信号**。数据结构里也刻意不含任何方向性字段。
 */

export type MasterKey = "BUFFETT" | "MUNGER" | "LYNCH" | "GRAHAM";

export const MASTER_ORDER: MasterKey[] = [
  "BUFFETT",
  "MUNGER",
  "LYNCH",
  "GRAHAM",
];

const NAME: Record<MasterKey, string> = {
  BUFFETT: "巴菲特",
  MUNGER: "芒格",
  LYNCH: "林奇",
  GRAHAM: "格雷厄姆",
};

/** 每位大师框架关心的信号词 + 一句话"关注点"（描述性）。 */
const SIGNALS: Record<MasterKey, { words: string[]; focus: string }> = {
  BUFFETT: {
    words: [
      "护城河", "竞争优势", "龙头", "品牌", "收购", "并购", "控股", "控制权",
      "分红", "回购", "提价", "涨价", "特许", "长期", "现金流", "毛利",
      "定价权", "市占", "扩张", "增持",
    ],
    focus: "护城河与生意质地",
  },
  MUNGER: {
    words: [
      "风险", "处罚", "违规", "违法", "立案", "诉讼", "仲裁", "造假",
      "商誉", "减值", "退市", "问询", "监管", "减持", "质押", "担保",
      "激励", "高管", "舞弊", "欺诈", "警示",
    ],
    focus: "反过来想·避开风险",
  },
  LYNCH: {
    words: [
      "业绩", "预增", "预盈", "扭亏", "增长", "订单", "中标", "产能",
      "扩产", "新产品", "新品", "需求", "放量", "渗透", "销量", "门店",
      "消费", "爆款", "出货", "签约",
    ],
    focus: "成长故事与拐点",
  },
  GRAHAM: {
    words: [
      "破产", "重整", "债务", "逾期", "违约", "亏损", "资产", "净资产",
      "估值", "市盈", "市净", "现金", "偿债", "清算", "安全边际", "低估",
      "计提", "预亏", "折价",
    ],
    focus: "内在价值与安全边际",
  },
};

const BASELINE = 34;
const STEP = 16;
const STRONG = 50; // ≥1 个信号词即视为"该视角相关"

export type CompassEntry = { kind: MasterKey; score: number; focus: string };
export type Compass = { entries: CompassEntry[]; headline: string };

export function masterCompass(news: {
  title: string;
  summary?: string | null;
}): Compass {
  const text = `${news.title}\n${news.summary ?? ""}`;
  const entries: CompassEntry[] = MASTER_ORDER.map((kind) => {
    const { words, focus } = SIGNALS[kind];
    const hits = words.filter((w) => text.includes(w)).length;
    const score = Math.min(100, BASELINE + hits * STEP);
    return { kind, score, focus };
  });

  const strong = entries.filter((e) => e.score >= STRONG);
  let headline: string;
  if (strong.length === 0) {
    headline = "常规资讯 · 各大师视角关注度平平，可先看中性解读";
  } else if (strong.length >= 3) {
    headline = `多位大师视角都高度相关：${strong
      .map((e) => NAME[e.kind])
      .join("、")}`;
  } else {
    headline = `视角侧重 · ${strong
      .map((e) => `${NAME[e.kind]}｜${e.focus}`)
      .join("；")}`;
  }

  return { entries, headline };
}

/** 单条资讯里契合度达标(相关)的大师视角；用于跨多条资讯聚合出实体的「多视角相关度」。 */
export function strongMasters(news: {
  title: string;
  summary?: string | null;
}): MasterKey[] {
  return masterCompass(news)
    .entries.filter((e) => e.score >= STRONG)
    .map((e) => e.kind);
}
