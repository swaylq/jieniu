import { describe, it, expect } from "vitest";
import {
  upcomingCatalysts,
  catalystCaption,
  CATALYST_WINDOW_DAYS,
  type CatalystRow,
} from "./catalyst-window";

const now = new Date(2026, 6, 31, 10, 0, 0); // 2026-07-31 本地 10:00

const row = (name: string, date: string, entityId = name): CatalystRow => ({
  entityId,
  name,
  periodLabel: "2026 年半年报",
  date,
});

describe("upcomingCatalysts", () => {
  it("按距今天数升序，只留窗口内的", () => {
    const r = upcomingCatalysts(
      [
        row("澜起科技", "2026-08-29"),
        row("兆易创新", "2026-08-19"),
        row("远的", "2026-12-01"), // 窗口外
      ],
      now,
      30,
    );
    expect(r.map((c) => c.name)).toEqual(["兆易创新", "澜起科技"]);
    expect(r[0]!.daysUntil).toBe(19);
    expect(r[1]!.daysUntil).toBe(29);
  });

  it("今天披露算「还有 0 天」，仍在窗口内", () => {
    const r = upcomingCatalysts([row("今天", "2026-07-31")], now, 30);
    expect(r).toHaveLength(1);
    expect(r[0]!.daysUntil).toBe(0);
  });

  it("已过期的不显示——挂着过去的节点比没有更糟", () => {
    expect(upcomingCatalysts([row("昨天", "2026-07-30")], now, 30)).toEqual([]);
  });

  it("日期按本地日解析，不走 UTC（否则整体偏一天）", () => {
    const r = upcomingCatalysts([row("甲", "2026-08-01")], now, 30);
    expect(r[0]!.daysUntil).toBe(1);
  });

  it("非法日期直接丢掉，不编", () => {
    expect(upcomingCatalysts([row("坏", "not-a-date")], now, 30)).toEqual([]);
  });

  it("同一标的多条只留最近的一条", () => {
    const r = upcomingCatalysts(
      [row("甲", "2026-08-25", "e1"), row("甲", "2026-08-11", "e1")],
      now,
      30,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.daysUntil).toBe(11);
  });

  it("默认窗口 30 天", () => {
    expect(CATALYST_WINDOW_DAYS).toBe(30);
    const r = upcomingCatalysts([row("甲", "2026-09-30")], now);
    expect(r).toEqual([]);
  });
});

describe("catalystCaption", () => {
  it("有节点 → 说清最近那个是谁、哪天、还有几天", () => {
    const items = upcomingCatalysts([row("兆易创新", "2026-08-19")], now, 30);
    const c = catalystCaption(items, 30);
    expect(c).toContain("兆易创新");
    expect(c).toContain("8/19");
    expect(c).toContain("19");
  });

  it("没节点 → 如实说没有，不拿法定截止日凑数", () => {
    const c = catalystCaption([], 30);
    expect(c).toContain("30");
    expect(c).toContain("没有");
  });
});
