// A 股交易时段判定（纯函数，浏览器与服务端共用）。
//
// 用途：个股页行情卡的实时轮询要**只在开市时轮询**——收盘后每 15 秒去打新浪一次，
// 拿回来的永远是同一个收盘价，纯属白烧用户流量和第三方接口配额。
//
// 时区：一律按**北京时间**判定，用固定 +8 偏移算，不读运行环境的本地时区。
// 轮询发生在用户的浏览器里，时区可能是任何值；而中国全境单一时区、无夏令时，
// 固定偏移是精确的。（同类坑见 evolution/lessons.md：`toISOString().slice(0,10)`
// 把本地 8/15 写成 8/14。）

/** 北京时间的分钟数（0–1439）与星期几（0=周日）。 */
function beijingParts(now: Date): { weekday: number; minutes: number } {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

const HM = (h: number, m: number) => h * 60 + m;

/**
 * 两段交易时段，**收盘侧各留 5 分钟缓冲**：
 * 上午 09:15（集合竞价起）–11:35（11:30 收盘 +5，等最后一笔落地）
 * 下午 12:55（13:00 开盘 -5）–15:05（15:00 收盘 +5）
 */
const SESSIONS: [number, number][] = [
  [HM(9, 15), HM(11, 35)],
  [HM(12, 55), HM(15, 5)],
];

/**
 * 此刻 A 股是否在交易（含集合竞价与收盘缓冲）。
 *
 * **不判节假日**——没有交易日历，硬编码一份必然过期。节假日误判的代价只是白轮询几次，
 * 价格不动、界面看不出区别；反过来把真实交易日判成休市才是用户能看见的伤害。
 */
export function isAShareTradingTime(now: Date): boolean {
  const { weekday, minutes } = beijingParts(now);
  if (weekday === 0 || weekday === 6) return false;
  return SESSIONS.some(([start, end]) => minutes >= start && minutes < end);
}
