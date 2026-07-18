import { describe, expect, it } from "vitest";

import { upcomingDisclosureNodes, NEAR_DAYS } from "./earnings-calendar";

describe("upcomingDisclosureNodes", () => {
  it("7 月中 → 下一个节点是半年报(8/31)", () => {
    const [first] = upcomingDisclosureNodes(new Date("2026-07-12T10:00:00"), 2);
    expect(first.label).toBe("半年报");
    expect(first.deadline.getMonth()).toBe(7); // 8 月 (0-indexed)
    expect(first.daysUntil).toBeGreaterThan(40);
    expect(first.daysUntil).toBeLessThan(55);
  });

  it("9 月中 → 下一个节点是三季报(10/31)", () => {
    const [first] = upcomingDisclosureNodes(new Date("2026-09-15T10:00:00"), 1);
    expect(first.label).toBe("三季报");
  });

  it("11 月中 → 下一个是次年年报·一季报(4/30)", () => {
    const [first] = upcomingDisclosureNodes(new Date("2026-11-15T10:00:00"), 1);
    expect(first.label).toBe("年报 · 一季报");
    expect(first.deadline.getFullYear()).toBe(2027);
  });

  it("节点按截止日升序、去掉已过期、take 生效", () => {
    const nodes = upcomingDisclosureNodes(new Date("2026-07-12T10:00:00"), 3);
    expect(nodes).toHaveLength(3);
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i].deadline.getTime()).toBeGreaterThan(
        nodes[i - 1].deadline.getTime(),
      );
    }
    // 全部为未来
    for (const n of nodes) expect(n.daysUntil).toBeGreaterThan(0);
  });

  it("临近阈值常量存在（用于高亮接下来 N 天内的节点）", () => {
    expect(NEAR_DAYS).toBeGreaterThan(0);
  });
});
