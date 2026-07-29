// 下次触发时刻。纯函数，rand 可注入以便测试。
//
// 两种语义：
//   interval —— 与 hermit-ui 完全一致：now + everySec ± uniform(jitterSec)。
//   daily    —— 锚定北京时间的钟点。hermit-ui 只有 interval，日级任务的钟点会随机游走
//               （实测「AI 早报」漂到了 17:31），所以这一档是新增的。
//
// 中国自 1991 年起无夏令时，Asia/Shanghai 恒为 UTC+8，按固定偏移算即可；
// schedule.test.ts 用 Intl.DateTimeFormat 交叉验证。

export type Schedule =
  | { kind: "interval"; everySec: number; jitterSec: number }
  | { kind: "daily"; atCST: string; jitterSec: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
/** jitter 为负时的兜底：下次触发至少在 1 分钟后，否则会被立刻判为到期而空转。 */
const MIN_LEAD_MS = 60_000;

function jitterMs(jitterSec: number, rand: () => number): number {
  if (jitterSec <= 0) return 0;
  return Math.round((rand() * 2 - 1) * jitterSec * 1000);
}

export function nextFireAfter(
  s: Schedule,
  fromMs: number,
  rand: () => number = Math.random,
): number {
  if (s.kind === "interval") {
    return fromMs + s.everySec * 1000 + jitterMs(s.jitterSec, rand);
  }

  const [hStr, mStr] = s.atCST.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (
    !Number.isInteger(h) ||
    !Number.isInteger(m) ||
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59
  ) {
    throw new Error(`daily.atCST 格式非法: ${s.atCST}（应为 "HH:MM"）`);
  }

  // 换算到「北京时钟」的时间轴上算当天零点，再换回 UTC 毫秒。
  const cstMs = fromMs + CST_OFFSET_MS;
  const cstMidnight = Math.floor(cstMs / DAY_MS) * DAY_MS;
  let target = cstMidnight + h * 3600_000 + m * 60_000 - CST_OFFSET_MS;
  if (target <= fromMs) target += DAY_MS;

  return Math.max(target + jitterMs(s.jitterSec, rand), fromMs + MIN_LEAD_MS);
}
