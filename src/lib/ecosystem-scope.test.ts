import { describe, it, expect } from "vitest";
import {
  identityIds,
  dedupeSectors,
  selectPeersFrom,
  type PeerCandidate,
} from "./ecosystem-scope";

const stock = (
  id: string,
  name: string,
  companyId: string | null,
): PeerCandidate => ({ id, name, type: "STOCK", ticker: id, companyId });
const company = (id: string, name: string): PeerCandidate => ({
  id,
  name,
  type: "COMPANY",
  ticker: null,
  companyId: id,
});

describe("identityIds — 公司和它发行的股票是同一个「我」", () => {
  it("把孪生实体并进来，自己排第一", () => {
    expect(identityIds("co", ["co", "stk"])).toEqual(["co", "stk"]);
  });
  it("去重，不把自己重复列进去", () => {
    expect(identityIds("stk", ["co", "stk", "co"])).toEqual(["stk", "co"]);
  });
  it("没有孪生实体时就是自己一个", () => {
    expect(identityIds("solo", [])).toEqual(["solo"]);
  });
});

describe("dedupeSectors — 两份身份都挂了同一个板块时只显示一次", () => {
  it("按 id 去重并保序", () => {
    const out = dedupeSectors([
      { id: "s1", name: "半导体" },
      { id: "s2", name: "汽车" },
      { id: "s1", name: "半导体" },
    ]);
    expect(out).toEqual([
      { id: "s1", name: "半导体" },
      { id: "s2", name: "汽车" },
    ]);
  });
});

describe("selectPeersFrom — 同侪不该漏掉股票成分，也不该出现自己", () => {
  const members = [
    stock("s-self", "宁德时代(300750)", "co-self"),
    stock("s-a", "亿纬锂能(300014)", "co-a"),
    company("co-a", "亿纬锂能"),
    stock("s-b", "国轩高科(002074)", "co-b"),
  ];

  it("自己的两份身份都被排除（公司页也不会把自己的股票当同侪）", () => {
    const ids = selectPeersFrom(["co-self", "s-self"], members).map((x) => x.id);
    expect(ids).not.toContain("s-self");
    expect(ids).not.toContain("co-self");
  });

  it("板块成分几乎都是 STOCK —— 不能因为「只要公司」就返回空", () => {
    const peers = selectPeersFrom(["co-self", "s-self"], members);
    expect(peers.length).toBeGreaterThan(0);
    expect(peers.map((x) => x.name)).toContain("亿纬锂能");
  });

  it("同一家公司的孪生实体只留一份，且优先用公司（搜索归一的规范页）", () => {
    const peers = selectPeersFrom(["co-self", "s-self"], members);
    const forA = peers.filter((x) => x.companyId === "co-a");
    expect(forA).toHaveLength(1);
    expect(forA[0]!.type).toBe("COMPANY");
  });

  it("没有对应公司的孤儿股票仍然保留", () => {
    const peers = selectPeersFrom(["co-self", "s-self"], [
      stock("orphan", "某退市股(000001)", null),
    ]);
    expect(peers.map((x) => x.id)).toEqual(["orphan"]);
  });

  it("按 limit 截断", () => {
    const peers = selectPeersFrom(["co-self", "s-self"], members, 1);
    expect(peers).toHaveLength(1);
  });
});
