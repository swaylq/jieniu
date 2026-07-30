import { describe, it, expect } from "vitest";
import {
  bucketOf,
  groupRelations,
  resolveQuoteTicker,
  type GraphRelation,
  type RelationBucket,
  type RelatedEntity,
} from "./entity-graph";

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

// QA loop run 61 维度 h：行情 ticker 只能取自己 ticker 或「发行股票」(stocks 桶)，
// 绝不能取 members(板块成分股)——否则 SECTOR 页把某成员的行情当成板块行情。
function groups(
  part: Partial<Record<RelationBucket, RelatedEntity[]>>,
): Record<RelationBucket, RelatedEntity[]> {
  return {
    sector: [], members: [], stocks: [], issuer: [],
    worksAt: [], people: [], related: [],
    ...part,
  };
}
const stock = (ticker: string): RelatedEntity => ({
  id: `e-${ticker}`, name: `股票${ticker}`, type: "STOCK", ticker,
});

describe("resolveQuoteTicker", () => {
  it("STOCK 实体用自己的 ticker", () => {
    expect(resolveQuoteTicker({ ticker: "600519" }, groups({}))).toBe("600519");
  });
  it("COMPANY(无 ticker) 用其发行股票(stocks 桶)的代码", () => {
    expect(
      resolveQuoteTicker({ ticker: null }, groups({ stocks: [stock("002371")] })),
    ).toBe("002371");
  });
  it("SECTOR(无 ticker) 即便有成分股(members 桶)也不显行情 → null", () => {
    // 旅游零售 的成员 中国中免(601888) 在 members 桶；不能当成板块行情。
    expect(
      resolveQuoteTicker({ ticker: null }, groups({ members: [stock("601888")] })),
    ).toBeNull();
  });
  it("PERSON/空关系 → null", () => {
    expect(resolveQuoteTicker({ ticker: null }, groups({}))).toBeNull();
  });
});
