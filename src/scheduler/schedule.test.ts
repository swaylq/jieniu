import { describe, it, expect } from "vitest";
import { nextFireAfter, nextFireAfterRun, type Schedule } from "./schedule";

/** 把毫秒格式成北京时间 "YYYY-MM-DD HH:mm"，用系统时区库交叉验证我们的定点计算。 */
function cst(ms: number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(ms))
    .replace("T", " ");
}

const noJitter = () => 0.5; // (0.5*2-1)=0 ⇒ 偏移恰好为 0

describe("interval", () => {
  it("无 jitter 时恰好加一个周期", () => {
    const s: Schedule = { kind: "interval", everySec: 1800, jitterSec: 300 };
    const from = Date.UTC(2026, 6, 29, 10, 0, 0);
    expect(nextFireAfter(s, from, noJitter)).toBe(from + 1800_000);
  });

  it("jitter 落在 ±jitterSec 内", () => {
    const s: Schedule = { kind: "interval", everySec: 1800, jitterSec: 300 };
    const from = Date.UTC(2026, 6, 29, 10, 0, 0);
    const lo = nextFireAfter(s, from, () => 0);
    const hi = nextFireAfter(s, from, () => 1);
    expect(lo).toBe(from + 1800_000 - 300_000);
    expect(hi).toBe(from + 1800_000 + 300_000);
  });
});

describe("daily", () => {
  it("当天还没到点 → 落在当天该时刻（北京时间）", () => {
    const s: Schedule = { kind: "daily", atCST: "07:20", jitterSec: 0 };
    const from = Date.UTC(2026, 6, 28, 22, 0, 0); // 北京时间 7-29 06:00
    expect(cst(nextFireAfter(s, from, noJitter))).toBe("2026-07-29 07:20");
  });

  it("当天已过点 → 顺延到次日", () => {
    const s: Schedule = { kind: "daily", atCST: "07:20", jitterSec: 0 };
    const from = Date.UTC(2026, 6, 29, 0, 0, 0); // 北京时间 7-29 08:00
    expect(cst(nextFireAfter(s, from, noJitter))).toBe("2026-07-30 07:20");
  });

  it("北京时间深夜求凌晨点位，不会跳过一整天", () => {
    const s: Schedule = { kind: "daily", atCST: "03:10", jitterSec: 0 };
    const from = Date.UTC(2026, 6, 29, 15, 0, 0); // 北京时间 7-29 23:00
    expect(cst(nextFireAfter(s, from, noJitter))).toBe("2026-07-30 03:10");
  });

  it("jitter 不会把下次触发算到过去", () => {
    const s: Schedule = { kind: "daily", atCST: "07:20", jitterSec: 600 };
    const from = Date.UTC(2026, 6, 28, 23, 19, 0); // 北京时间 07:19，距点位仅 1 分钟
    const next = nextFireAfter(s, from, () => 0); // 最大负偏移 -10min
    expect(next).toBeGreaterThan(from);
  });
});

// 一轮跑完之后的下一次触发。daily 的语义是「一天只跑一次」，不是「now 之后的下一个锚点」——
// 线上真撞过：brief-morning（锚点 07:20、jitter ±10min）因负 jitter 在 07:13 开跑、07:14 跑完，
// 「07:14 之后的下一个 07:20」还是**今天**，于是又排了一轮，一早连跑三次。
describe("nextFireAfterRun", () => {
  it("interval：与 nextFireAfter 同义，从当下起算一个周期", () => {
    const s: Schedule = { kind: "interval", everySec: 1800, jitterSec: 300 };
    const lastFire = Date.UTC(2026, 6, 30, 1, 0, 0);
    const now = lastFire + 120_000;
    expect(nextFireAfterRun(s, lastFire, now, noJitter)).toBe(now + 1800_000);
  });

  it("daily：在锚点之前跑完，下次必须是明天，不能又落回今天的锚点", () => {
    const s: Schedule = { kind: "daily", atCST: "07:20", jitterSec: 600 };
    const lastFire = Date.UTC(2026, 6, 29, 23, 13, 0); // 北京 7-30 07:13
    const now = Date.UTC(2026, 6, 29, 23, 14, 52); // 北京 7-30 07:14:52，还没到 07:20
    expect(cst(nextFireAfterRun(s, lastFire, now, noJitter))).toBe("2026-07-31 07:20");
  });

  it("daily：在锚点之后跑完，下次同样是明天", () => {
    const s: Schedule = { kind: "daily", atCST: "03:10", jitterSec: 900 };
    const lastFire = Date.UTC(2026, 6, 29, 19, 11, 0); // 北京 7-30 03:11
    const now = lastFire + 124_000;
    expect(cst(nextFireAfterRun(s, lastFire, now, noJitter))).toBe("2026-07-31 03:10");
  });

  it("daily：跨零点跑完，锚点仍按开火那天的次日算", () => {
    const s: Schedule = { kind: "daily", atCST: "23:45", jitterSec: 0 };
    const lastFire = Date.UTC(2026, 6, 30, 15, 50, 0); // 北京 7-30 23:50
    const now = Date.UTC(2026, 6, 30, 16, 30, 0); // 北京 7-31 00:30
    expect(cst(nextFireAfterRun(s, lastFire, now, noJitter))).toBe("2026-07-31 23:45");
  });

  it("daily：下次触发永远在当下之后（长任务把锚点跑过去了也不会排到过去）", () => {
    const s: Schedule = { kind: "daily", atCST: "03:10", jitterSec: 900 };
    const lastFire = Date.UTC(2026, 6, 29, 19, 11, 0); // 北京 7-30 03:11
    const now = Date.UTC(2026, 6, 30, 19, 20, 0); // 北京 7-31 03:20，已过次日锚点
    expect(nextFireAfterRun(s, lastFire, now, noJitter)).toBeGreaterThan(now);
  });
});
