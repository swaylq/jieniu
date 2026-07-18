import { describe, it, expect } from "vitest";
import { propagateImpact, IMPACT_PATH_LABEL, type ImpactEdge } from "./impact";

// 图：src、p(竞品 RELATED)、q(同板块 sec1)、r(无关 sec2)、src∈sec1
const edges: ImpactEdge[] = [
  { fromId: "src", toId: "sec1", type: "BELONGS_TO" },
  { fromId: "q", toId: "sec1", type: "BELONGS_TO" },
  { fromId: "r", toId: "sec2", type: "BELONGS_TO" },
  { fromId: "src", toId: "p", type: "RELATED" },
];

describe("propagateImpact", () => {
  it("finds peer (RELATED) and same-sector holdings, excludes source and unrelated", () => {
    const hits = propagateImpact("src", edges, ["src", "p", "q", "r"]);
    const byId = Object.fromEntries(hits.map((h) => [h.entityId, h]));
    expect(byId.src).toBeUndefined(); // 源不计
    expect(byId.p!.path).toBe("peer");
    expect(byId.q!.path).toBe("sector");
    expect(byId.r).toBeUndefined(); // 不同板块、非竞品
  });
  it("peer relevance beats sector and sorts first", () => {
    const hits = propagateImpact("src", edges, ["q", "p"]);
    expect(hits[0]!.entityId).toBe("p");
    expect(hits[0]!.relevance).toBeGreaterThan(hits[1]!.relevance);
  });
  it("prefers peer path when a holding is both peer and same-sector", () => {
    const both: ImpactEdge[] = [
      ...edges,
      { fromId: "p", toId: "sec1", type: "BELONGS_TO" }, // p 也同板块
    ];
    const hits = propagateImpact("src", both, ["p"]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.path).toBe("peer");
  });
  it("empty when no relations reach other holdings", () => {
    expect(propagateImpact("src", edges, ["src"])).toEqual([]);
    expect(propagateImpact("lonely", [], ["a", "b"])).toEqual([]);
  });
  it("labels are hedged (关联/同板块, not causal)", () => {
    expect(IMPACT_PATH_LABEL.peer).toContain("关联");
    expect(IMPACT_PATH_LABEL.sector).toBe("同板块");
  });
});
