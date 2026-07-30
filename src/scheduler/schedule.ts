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

/** 解析 "HH:MM"，返回当天零点起的毫秒偏移。 */
function anchorOffsetMs(atCST: string): number {
  const [hStr, mStr] = atCST.split(":");
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
    throw new Error(`daily.atCST 格式非法: ${atCST}（应为 "HH:MM"）`);
  }
  return h * 3600_000 + m * 60_000;
}

/** 某个时刻所在「北京日历日」的零点（UTC 毫秒）。 */
function cstDayStart(ms: number): number {
  return Math.floor((ms + CST_OFFSET_MS) / DAY_MS) * DAY_MS - CST_OFFSET_MS;
}

/**
 * `fromMs` **之后**的下一次触发。用于首次排期（enable.ts、从未跑过的任务）。
 *
 * 注意 daily 的语义是「from 之后的下一个锚点」——**不要**拿它算「跑完之后的下一次」，
 * 那是 `nextFireAfterRun` 的活儿（见下面那条注释里的线上事故）。
 */
export function nextFireAfter(
  s: Schedule,
  fromMs: number,
  rand: () => number = Math.random,
): number {
  if (s.kind === "interval") {
    return fromMs + s.everySec * 1000 + jitterMs(s.jitterSec, rand);
  }
  let target = cstDayStart(fromMs) + anchorOffsetMs(s.atCST);
  if (target <= fromMs) target += DAY_MS;
  return Math.max(target + jitterMs(s.jitterSec, rand), fromMs + MIN_LEAD_MS);
}

/**
 * 一轮跑完之后的下一次触发。
 *
 * interval：从当下起算一个周期，与 `nextFireAfter` 同义。
 * daily：**开火那个北京日历日的次日**锚点 —— 语义是「一天只跑一次」。
 *
 * 为什么不能直接用 `nextFireAfter(s, now)`：线上真撞过。`brief-morning`
 * （锚点 07:20、jitter ±10min）因负 jitter 在 07:13 开跑、07:14 跑完，
 * 「07:14 之后的下一个 07:20」还是**今天**，于是又排一轮，一早连跑三次、
 * 烧了三份 AI 钱。锚点必须挂在开火日上，不能挂在完成时刻上。
 *
 * 用 `lastFireMs`（开火时刻）而不是完成时刻，所以一条跑两小时的任务也不会把钟点推后。
 */
export function nextFireAfterRun(
  s: Schedule,
  lastFireMs: number,
  nowMs: number,
  rand: () => number = Math.random,
): number {
  if (s.kind === "interval") {
    return nowMs + s.everySec * 1000 + jitterMs(s.jitterSec, rand);
  }
  const target = cstDayStart(lastFireMs) + DAY_MS + anchorOffsetMs(s.atCST);
  return Math.max(target + jitterMs(s.jitterSec, rand), nowMs + MIN_LEAD_MS);
}
