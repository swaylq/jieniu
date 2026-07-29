import { describe, it, expect } from "vitest";
import { nextFireAfter, type Schedule } from "./schedule";

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
