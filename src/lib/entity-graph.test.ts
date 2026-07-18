import { describe, it, expect } from "vitest";
import { bucketOf, groupRelations, type GraphRelation } from "./entity-graph";

describe("bucketOf", () => {
  it("maps type+direction to a bucket", () => {
    expect(bucketOf("BELONGS_TO", "out")).toBe("sector");
    expect(bucketOf("BELONGS_TO", "in")).toBe("members");
    expect(bucketOf("ISSUES", "out")).toBe("stocks");
    expect(bucketOf("ISSUES", "in")).toBe("issuer");
    expect(bucketOf("WORKS_AT", "out")).toBe("worksAt");
    expect(bucketOf("WORKS_AT", "in")).toBe("people");
    expect(bucketOf("RELATED", "out")).toBe("related");
  });
});

describe("groupRelations", () => {
  it("buckets each relation and keeps empty buckets as []", () => {
    const rels: GraphRelation[] = [
      { type: "BELONGS_TO", direction: "out", entity: { id: "s1", name: "半导体", type: "SECTOR" } },
      { type: "ISSUES", direction: "out", entity: { id: "k1", name: "中芯国际(688981)", type: "STOCK" } },
    ];
    const g = groupRelations(rels);
    expect(g.sector).toEqual([{ id: "s1", name: "半导体", type: "SECTOR" }]);
    expect(g.stocks.map((e) => e.id)).toEqual(["k1"]);
    expect(g.people).toEqual([]);
  });
});
