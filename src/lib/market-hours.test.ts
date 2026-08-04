import { describe, expect, it } from "vitest";

import { isAShareTradingTime } from "./market-hours";

/**
 * 判定用的时刻一律写成 **UTC 字面量**，而不是 `new Date("2026-08-05 10:00")`——
 * 后者按运行环境的本地时区解析，测试在 UTC 的 CI 上和在 +08 的本机上会得出不同结论。
 * 北京时间 = UTC + 8（中国无夏令时），所以 10:00 CST 写成 02:00Z。
 *
 * 2026-08-05 是周三，2026-08-08 是周六。
 */
const cst = (iso: string) => new Date(iso);

describe("isAShareTradingTime", () => {
  it("工作日上午连续竞价时段内为 true", () => {
    expect(isAShareTradingTime(cst("2026-08-05T02:00:00Z"))).toBe(true); // 周三 10:00
  });

  it("工作日午休时段为 false", () => {
    expect(isAShareTradingTime(cst("2026-08-05T04:00:00Z"))).toBe(false); // 周三 12:00
  });

  it("工作日下午连续竞价时段内为 true", () => {
    expect(isAShareTradingTime(cst("2026-08-05T06:00:00Z"))).toBe(true); // 周三 14:00
  });

  it("开盘前（早于集合竞价）为 false", () => {
    expect(isAShareTradingTime(cst("2026-08-05T01:10:00Z"))).toBe(false); // 周三 09:10
  });

  it("集合竞价 09:15 起即为 true", () => {
    expect(isAShareTradingTime(cst("2026-08-05T01:15:00Z"))).toBe(true); // 周三 09:15
  });

  it("收盘后留 5 分钟缓冲——15:03 仍为 true，15:10 为 false", () => {
    expect(isAShareTradingTime(cst("2026-08-05T07:03:00Z"))).toBe(true); // 周三 15:03
    expect(isAShareTradingTime(cst("2026-08-05T07:10:00Z"))).toBe(false); // 周三 15:10
  });

  it("周末全天为 false", () => {
    expect(isAShareTradingTime(cst("2026-08-08T02:00:00Z"))).toBe(false); // 周六 10:00
    expect(isAShareTradingTime(cst("2026-08-09T06:00:00Z"))).toBe(false); // 周日 14:00
  });

  it("按北京时区判定，不受运行环境本地时区影响", () => {
    // 这一刻在 UTC 是周二 23:30（深夜、非交易日历上的工作日白天），
    // 但在北京是周三 07:30 —— 两边算出来的「星期几」都对得上工作日，
    // 真正要钉住的是**时刻**：07:30 不在交易时段，必须 false。
    expect(isAShareTradingTime(cst("2026-08-04T23:30:00Z"))).toBe(false);
    // 这一刻在 UTC 是周日 23:59，在北京已是周一 07:59 之前——同样非交易时段。
    expect(isAShareTradingTime(cst("2026-08-09T23:59:00Z"))).toBe(false);
    // 而 UTC 周日 06:00 = 北京周日 14:00，星期几在两个时区都是周日，仍是 false（周末）。
    expect(isAShareTradingTime(cst("2026-08-09T06:00:00Z"))).toBe(false);
    // 关键用例：UTC 周日 23:59 + 1 分钟 = 北京周一 08:00，仍未开盘；
    // 而 UTC 周一 01:20 = 北京周一 09:20，开盘了。
    expect(isAShareTradingTime(cst("2026-08-10T01:20:00Z"))).toBe(true);
  });
});
