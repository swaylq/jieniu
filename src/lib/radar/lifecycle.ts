/**
 * 信号生命周期（需求 §9）——纯函数、无 IO、可测。
 *
 * 需求原话：「不要让旧机会长期停留在页面上」。所以默认行为是**过期**，
 * 续命要靠新的确认，不是靠没人来清理。
 */

export type SignalType = "EARLY" | "CONFIRMED" | "RELATIVE_STRENGTH";
export type SignalStatus = "ACTIVE" | "CONFIRMED" | "EXPIRED" | "RISK";

/** 「刚刚启动」默认有效几个交易日。 */
export const EARLY_VALID_DAYS = 3;
/** 「趋势形成」有效几个交易日——已被市场确认，可以看得久一点。 */
export const CONFIRMED_VALID_DAYS = 5;
/** 广度回落多少算「明显下降」（上涨股占比的绝对降幅）。 */
export const BREADTH_DROP_LIMIT = 0.2;

const DAY_MS = 24 * 60 * 60 * 1000;

export type LiveSignal = {
  signalType: SignalType;
  status: SignalStatus;
  /** 信号基准交易日 YYYY-MM-DD */
  tradeDate: string;
  entityName: string;
};

export type Confirmation = {
  /** 距生成已过去几个交易日 */
  tradeDaysElapsed: number;
  stillPassesEarly: boolean;
  passesConfirmed: boolean;
  posFlowDays3: number;
  /** 上涨股占比相对信号生成时的降幅（正数=下降） */
  breadthDrop: number;
  severeCrowding: boolean;
};

/**
 * 失效时刻。交易日 → 自然日按 1.6 倍放宽（周末），够粗但可解释；
 * 真正决定生死的是 `advanceSignal` 里的 `tradeDaysElapsed`，这里只是兜底墙。
 */
export function expiryFor(type: SignalType, from: Date): Date {
  const days = type === "CONFIRMED" ? CONFIRMED_VALID_DAYS : EARLY_VALID_DAYS;
  return new Date(from.getTime() + Math.ceil(days * 1.6) * DAY_MS);
}

export type Advance = {
  signalType: SignalType;
  status: SignalStatus;
  note: string;
};

/**
 * 一条信号在新一个交易日的去向。
 *
 * 优先级是有意的：**拥挤 > 降级 > 升级 > 到期**。
 * 过热的时候就不该再劝人进场，哪怕它同时满足了"趋势形成"的全部条件——
 * 所以拥挤判定排在升级之前。
 */
export function advanceSignal(prev: LiveSignal, c: Confirmation): Advance {
  if (c.severeCrowding)
    return {
      signalType: prev.signalType,
      status: "RISK",
      note: "已触发过热条件，转为追高风险提示",
    };

  if (c.posFlowDays3 === 0)
    return {
      signalType: prev.signalType,
      status: "EXPIRED",
      note: "资金已转为持续流出，信号失效",
    };

  if (c.breadthDrop > BREADTH_DROP_LIMIT)
    return {
      signalType: prev.signalType,
      status: "EXPIRED",
      note: "上涨广度明显下降，信号失效",
    };

  if (prev.signalType === "EARLY" && c.passesConfirmed)
    return {
      signalType: "CONFIRMED",
      status: "CONFIRMED",
      note: "已获资金与广度确认，升级为趋势形成",
    };

  const limit =
    prev.signalType === "CONFIRMED" ? CONFIRMED_VALID_DAYS : EARLY_VALID_DAYS;
  if (c.tradeDaysElapsed >= limit)
    return {
      signalType: prev.signalType,
      status: "EXPIRED",
      note: `${limit} 个交易日内未获进一步确认，自动失效`,
    };

  return {
    signalType: prev.signalType,
    status: prev.status === "CONFIRMED" ? "CONFIRMED" : "ACTIVE",
    note: "仍在有效期内",
  };
}
