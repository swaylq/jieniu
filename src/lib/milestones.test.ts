import { describe, it, expect } from "vitest";
import {
  groupByMonth,
  isExpanded,
  spanSummary,
  EXPANDED_MONTHS,
} from "./milestones";

const item = (id: string, at: string) => ({ id, publishedAt: new Date(at) });

describe("groupByMonth", () => {
  it("按自然月倒序分组", () => {
    const g = groupByMonth([
      item("a", "2026-07-20T00:00:00Z"),
      item("b", "2026-07-02T00:00:00Z"),
      item("c", "2026-05-11T00:00:00Z"),
      item("d", "2025-12-31T12:00:00Z"),
    ]);
    expect(g.map((x) => x.key)).toEqual(["2026-07", "2026-05", "2025-12"]);
    expect(g[0]!.items.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("月内保持传入顺序（调用方已按时间倒序取数）", () => {
    const g = groupByMonth([
      item("new", "2026-07-20T00:00:00Z"),
      item("old", "2026-07-01T00:00:00Z"),
    ]);
    expect(g[0]!.items.map((x) => x.id)).toEqual(["new", "old"]);
  });

  it("中文月份标签不补零", () => {
    const g = groupByMonth([item("a", "2026-05-11T00:00:00Z")]);
    expect(g[0]!.label).toBe("2026年5月");
  });

  it("无效日期归入「时间未知」并排到最后，不丢数据", () => {
    const g = groupByMonth([
      { id: "bad", publishedAt: "not-a-date" },
      item("ok", "2026-07-20T00:00:00Z"),
    ]);
    expect(g.map((x) => x.key)).toEqual(["2026-07", "unknown"]);
    expect(g[1]!.label).toBe("时间未知");
    expect(g.reduce((n, m) => n + m.items.length, 0)).toBe(2);
  });

  it("空输入返回空数组", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe("isExpanded", () => {
  it("只展开最近 EXPANDED_MONTHS 个月", () => {
    expect(isExpanded(0)).toBe(true);
    expect(isExpanded(EXPANDED_MONTHS - 1)).toBe(true);
    expect(isExpanded(EXPANDED_MONTHS)).toBe(false);
  });
});

describe("spanSummary", () => {
  it("条数与月份数都来自实际分组", () => {
    const g = groupByMonth([
      item("a", "2026-07-20T00:00:00Z"),
      item("b", "2026-07-02T00:00:00Z"),
      item("c", "2026-05-11T00:00:00Z"),
    ]);
    expect(spanSummary(g)).toBe("共 3 条 · 覆盖 2 个月");
  });

  it("「时间未知」计入条数但不计入月份数", () => {
    const g = groupByMonth([
      item("a", "2026-07-20T00:00:00Z"),
      { id: "bad", publishedAt: "nope" },
    ]);
    expect(spanSummary(g)).toBe("共 2 条 · 覆盖 1 个月");
  });
});
