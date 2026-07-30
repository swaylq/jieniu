export const DIGEST_WINDOW_HOURS = 24;
/**
 * 自选股早报（personalDigest）的时间窗——比市场早报宽：单只股票 24h 未必有料，放宽到 48h 才不至于常空。
 * 卡副标的「近 N 小时」须据此显示，别把 48h 的自选股段标成「近 24 小时」（QA loop run 41 维度 f）。
 */
export const PERSONAL_DIGEST_WINDOW_HOURS = 48;
export const DIGEST_TAKE = 6;
/** 深度版早报取更多条（客户端「30 秒/3 分钟/深度」分层切换的上限，P5-3）。 */
export const DIGEST_TAKE_DEEP = 12;

/** 早报时间窗起点：now 往前 DIGEST_WINDOW_HOURS 小时。 */
export function digestSince(now: Date): Date {
  return new Date(now.getTime() - DIGEST_WINDOW_HOURS * 60 * 60 * 1000);
}

/** 早报副标题：近 N 小时 · 重磅 Top X（X = 实际展示条数，诚实不夸大）。 */
export function digestCaption(count: number): string {
  return `近 ${DIGEST_WINDOW_HOURS} 小时 · 重磅 Top ${count}`;
}

/**
 * 早报卡副标该显示的时间窗（小时）：卡里同时有自选股段时，展示内容里最旧的可能是 48h 前的自选股项，
 * 故须标 48h（对市场段的 24h 项是宽松但不失真的上界）；只有市场段时标 24h。
 */
export function digestWindowHours(hasPersonal: boolean): number {
  return hasPersonal ? PERSONAL_DIGEST_WINDOW_HOURS : DIGEST_WINDOW_HOURS;
}
