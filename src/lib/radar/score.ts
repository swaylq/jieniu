/**
 * 机会雷达的评分层（纯函数、无 IO、可测）——需求 §3 / §4 / §5 / §6 / §7。
 *
 * 三条设计约束，都是需求里写死的：
 *  ① **数值计算、筛选、排序必须由程序完成**，大模型只解释不评分（§11）。所以这里
 *     不出现任何 AI 调用，输入是分位数、输出是分数。
 *  ② **前台不显示 76.3 这种假精确数字**（§4）。`strengthLabel` 是分数与展示之间的唯一闸口。
 *  ③ 主力资金不能单独决定入选（§3）——这一条不在评分里实现，在 `gates.ts` 的
 *     合取式里实现：价格/广度/催化至少一项确认。评分只负责排序。
 */

// ---------------------------------------------------------------------------
// §3 资金强度
// ---------------------------------------------------------------------------

export type FundInputs = {
  /** 主力净流入绝对金额的横截面分位 */
  absPct: number;
  /** 主力净流入 ÷ 当日成交额 的横截面分位 */
  ratioPct: number;
  /** 主力净流入 ÷ 流通市值 的横截面分位。拿不到流通市值时传 null */
  floatPct: number | null;
  /** 当前资金相对**自身**过去 60 日的异常程度（已是 0..100） */
  anomalyPct: number;
  /** 最近 5 日资金持续性的横截面分位 */
  persistPct: number;
};

/**
 * 资金得分 0..100。
 *
 * 基础权重 25/35/25/15（需求给的初始公式）；**有可靠流通市值数据时**从前两项
 * 各挪 5%，给「净流入/流通市值」10%——需求 §3 的"可以调整"落到这里，
 * 权重恒和为 1，所以有没有市值数据两条路的量纲一致、可比。
 */
export function fundStrengthScore(i: FundInputs): number {
  const hasFloat = i.floatPct !== null;
  const wAbs = hasFloat ? 0.2 : 0.25;
  const wRatio = hasFloat ? 0.3 : 0.35;
  const wFloat = hasFloat ? 0.1 : 0;
  return (
    wAbs * i.absPct +
    wRatio * i.ratioPct +
    wFloat * (i.floatPct ?? 0) +
    0.25 * i.anomalyPct +
    0.15 * i.persistPct
  );
}

// ---------------------------------------------------------------------------
// §6 催化质量
// ---------------------------------------------------------------------------

/** 催化等级。判定见 `catalyst.ts`——按**来源硬度**判，不按 AI 感觉判。 */
export type CatalystGrade = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export function catalystScore(g: CatalystGrade): number {
  switch (g) {
    case "HIGH":
      return 100;
    case "MEDIUM":
      return 65;
    case "LOW":
      return 30;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// §7 过热与追高
// ---------------------------------------------------------------------------

export type CrowdInputs = {
  scope: "SECTOR" | "STOCK";
  ret5: number | null;
  ret20: number | null;
  /** 当日成交额 / 过去 20 日均额 */
  amountRatio20: number | null;
  /** 涨停股占比（板块内）。个股场景传 null */
  limitUpShare: number | null;
  /** 股价上涨但资金连续流出 */
  priceUpFlowOut: boolean;
  /** 前三只股票贡献的资金流入占比（板块） */
  topConcentration: number | null;
};

export type Crowding = { penalty: number; severe: boolean; flags: string[] };

/** 阈值全部来自需求 §7，写成常量供测试与前台文案共用。 */
export const CROWD = {
  sectorRet5: 12,
  sectorRet20: 25,
  stockRet5: 20,
  stockRet20: 35,
  amountRatio: 2.5,
  limitUpShare: 0.15,
  topConcentration: 0.7,
  /** 每命中一条扣的分 */
  perFlag: 12,
  /** 命中几条算「严重拥挤」——严重就不进机会列表，转追高风险 */
  severeAt: 2,
} as const;

/**
 * 拥挤判定。**缺数据一律不算触发**——「没量到」既不是"过热"也不是"安全"，
 * 把 null 当成任何一边都会造出静默的错误结论（同「空页 ≠ 翻到底」那条教训）。
 */
export function crowding(i: CrowdInputs): Crowding {
  const flags: string[] = [];
  const r5 = i.scope === "SECTOR" ? CROWD.sectorRet5 : CROWD.stockRet5;
  const r20 = i.scope === "SECTOR" ? CROWD.sectorRet20 : CROWD.stockRet20;

  if (i.ret5 !== null && i.ret5 > r5)
    flags.push(`${i.scope === "SECTOR" ? "行业" : "个股"}5日涨幅已达 ${i.ret5.toFixed(1)}%`);
  if (i.ret20 !== null && i.ret20 > r20)
    flags.push(`${i.scope === "SECTOR" ? "行业" : "个股"}20日涨幅已达 ${i.ret20.toFixed(1)}%`);
  if (i.amountRatio20 !== null && i.amountRatio20 > CROWD.amountRatio)
    flags.push(`成交额是 20 日均量的 ${i.amountRatio20.toFixed(1)} 倍`);
  if (i.limitUpShare !== null && i.limitUpShare > CROWD.limitUpShare)
    flags.push(`涨停股占比 ${(i.limitUpShare * 100).toFixed(0)}%`);
  if (i.priceUpFlowOut) flags.push("股价上涨但资金连续流出");
  if (i.topConcentration !== null && i.topConcentration > CROWD.topConcentration)
    flags.push(
      `涨幅/资金主要由前三只贡献（${(i.topConcentration * 100).toFixed(0)}%）`,
    );

  return {
    penalty: flags.length * CROWD.perFlag,
    severe: flags.length >= CROWD.severeAt,
    flags,
  };
}

// ---------------------------------------------------------------------------
// §4 行业机会分 / §5 个股机会分
// ---------------------------------------------------------------------------

export type SectorScoreInputs = {
  fund: number;
  relStrength: number;
  breadth: number;
  persistence: number;
  catalyst: number;
  crowdPenalty: number;
  dataPenalty: number;
};

export function sectorOpportunityScore(i: SectorScoreInputs): number {
  const raw =
    0.3 * i.fund +
    0.25 * i.relStrength +
    0.2 * i.breadth +
    0.15 * i.persistence +
    0.1 * i.catalyst -
    i.crowdPenalty -
    i.dataPenalty;
  return Math.max(0, Math.min(100, raw));
}

export type StockScoreInputs = {
  relToSector: number;
  fund: number;
  catalyst: number;
  sectorSignal: number;
  priceStage: number;
  crowdPenalty: number;
  dataPenalty: number;
};

export function stockOpportunityScore(i: StockScoreInputs): number {
  const raw =
    0.3 * i.relToSector +
    0.3 * i.fund +
    0.2 * i.catalyst +
    0.1 * i.sectorSignal +
    0.1 * i.priceStage -
    i.crowdPenalty -
    i.dataPenalty;
  return Math.max(0, Math.min(100, raw));
}

// ---------------------------------------------------------------------------
// 展示闸口
// ---------------------------------------------------------------------------

/** 65 分以下不展示。 */
export const DISPLAY_MIN = 65;
/** 75 分以上「信号强」。 */
export const STRONG_MIN = 75;

export type SignalStrength = "STRONG" | "MEDIUM";

/**
 * 分数 → 展示强度。**这是分数唯一允许离开后台的形式**：
 * 前台只出现「强 / 中」，不出现 76.3（需求 §4：不显示假精确数字）。
 */
export function strengthLabel(score: number): SignalStrength | null {
  if (score >= STRONG_MIN) return "STRONG";
  if (score >= DISPLAY_MIN) return "MEDIUM";
  return null;
}
