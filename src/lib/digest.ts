export const DIGEST_WINDOW_HOURS = 24;
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
