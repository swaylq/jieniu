import { describe, it, expect } from "vitest";
import { buildReactions, avgAbsOnDay } from "./earnings-reaction";
import { parseAppointment, type AppointRow } from "./disclosure";
import type { Bar } from "./kline";

const bars: Bar[] = [
  { day: "2026-04-16", close: 100, changePct: 1.0 },
  { day: "2026-04-17", close: 103, changePct: 3.0 },
  { day: "2026-04-20", close: 101, changePct: -2.0 },
  { day: "2026-04-24", close: 105, changePct: 4.0 },
  { day: "2026-04-27", close: 100, changePct: -5.0 },
];

function appt(type: string, year: string, actual: string): AppointRow {
  return {
    SECURITY_CODE: "600519",
    REPORT_TYPE: type,
    REPORT_YEAR: year,
    REPORT_DATE: `${year}-12-31 00:00:00`,
    FIRST_APPOINT_DATE: `${actual} 00:00:00`,
    ACTUAL_PUBLISH_DATE: `${actual} 00:00:00`,
  };
}
const now = new Date(2026, 6, 28);
const parse = (r: AppointRow) => parseAppointment(r, now)!;

describe("buildReactions", () => {
  it("披露日当天是交易日时取当日涨跌幅，并给出次一交易日", () => {
    const rs = buildReactions([parse(appt("4", "2025", "2026-04-17"))], bars);
    expect(rs).toHaveLength(1);
    expect(rs[0]!.onDay).toEqual({ day: "2026-04-17", changePct: 3.0 });
    expect(rs[0]!.nextDay).toEqual({ day: "2026-04-20", changePct: -2.0 });
  });

  it("披露日不是交易日（周末/停牌）时顺延到下一个有行情的交易日", () => {
    // 4-18 是周六，没有 bar → 顺延到 4-20
    const rs = buildReactions([parse(appt("4", "2025", "2026-04-18"))], bars);
    expect(rs[0]!.onDay!.day).toBe("2026-04-20");
    expect(rs[0]!.nextDay!.day).toBe("2026-04-24");
  });

  it("披露日晚于全部行情（K 线没覆盖到）时不产出这条——没数据就不显示", () => {
    expect(buildReactions([parse(appt("4", "2025", "2026-05-10"))], bars)).toEqual([]);
  });

  it("最后一根之后没有次日时 nextDay 为 null，当日仍保留", () => {
    const rs = buildReactions([parse(appt("4", "2025", "2026-04-27"))], bars);
    expect(rs[0]!.onDay!.day).toBe("2026-04-27");
    expect(rs[0]!.nextDay).toBeNull();
  });

  it("按披露日降序，最近的一次排最前", () => {
    const rs = buildReactions(
      [
        parse(appt("1", "2026", "2026-04-17")),
        parse(appt("4", "2025", "2026-04-24")),
      ],
      bars,
    );
    expect(rs.map((r) => r.disclosedOn)).toEqual(["2026-04-24", "2026-04-17"]);
  });

  it("limit 截断取最近 N 次", () => {
    const rs = buildReactions(
      [
        parse(appt("1", "2026", "2026-04-17")),
        parse(appt("4", "2025", "2026-04-24")),
      ],
      bars,
      1,
    );
    expect(rs).toHaveLength(1);
    expect(rs[0]!.disclosedOn).toBe("2026-04-24");
  });

  it("尚未实际披露的不进统计——历史反应只统计已发生的", () => {
    const pending = parseAppointment(
      { ...appt("2", "2026", "2026-04-17"), ACTUAL_PUBLISH_DATE: null },
      now,
    )!;
    expect(buildReactions([pending], bars)).toEqual([]);
  });

  it("没有行情数据时返回空——不拿空数组算平均", () => {
    expect(buildReactions([parse(appt("4", "2025", "2026-04-17"))], [])).toEqual([]);
  });
});

describe("avgAbsOnDay", () => {
  it("给出近 N 次披露日涨跌幅的平均绝对值", () => {
    const rs = buildReactions(
      [
        parse(appt("1", "2026", "2026-04-17")), // +3.0
        parse(appt("4", "2025", "2026-04-27")), // -5.0
      ],
      bars,
    );
    expect(avgAbsOnDay(rs)).toBe(4); // (|3|+|5|)/2
  });

  it("无样本返回 null", () => {
    expect(avgAbsOnDay([])).toBeNull();
  });
});
