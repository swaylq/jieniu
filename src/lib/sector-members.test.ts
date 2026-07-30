import { describe, it, expect } from "vitest";

import { dedupeSectorMembers } from "./sector-members";

describe("dedupeSectorMembers", () => {
  it("collapses a firm's STOCK + same-name COMPANY into one, preferring the STOCK", () => {
    // 半导体既有行业分类的 STOCK「中芯国际(688981)」，又有主题分类的 COMPANY「中芯国际」——
    // 同一家公司，不能算两只。合并、留 STOCK（可链到个股页）、热度相加。
    const out = dedupeSectorMembers([
      { id: "s1", name: "中芯国际(688981)", type: "STOCK", heat: 10 },
      { id: "c1", name: "中芯国际", type: "COMPANY", heat: 5 },
      { id: "s2", name: "北方华创(002371)", type: "STOCK", heat: 8 },
      { id: "c2", name: "某AI公司", type: "COMPANY", heat: 3 }, // 无同名 STOCK
    ]);
    expect(out).toHaveLength(3); // 中芯国际 去重后 1 家
    // 按热度降序：中芯国际 15 > 北方华创 8 > 某AI公司 3
    expect(out[0]!.id).toBe("s1");
    expect(out[0]!.heat).toBe(15); // 10 + 5 合并
    expect(out[1]!.id).toBe("s2");
    expect(out[2]!.id).toBe("c2"); // 无 STOCK 的公司仍保留
  });

  it("keeps distinct firms and returns empty for empty input", () => {
    expect(dedupeSectorMembers([])).toEqual([]);
    const out = dedupeSectorMembers([
      { id: "a", name: "甲(1)", type: "STOCK", heat: 1 },
      { id: "b", name: "乙(2)", type: "STOCK", heat: 2 },
    ]);
    expect(out).toHaveLength(2);
  });
});
