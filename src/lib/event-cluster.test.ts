import { describe, it, expect } from "vitest";
import {
  charBigrams,
  jaccard,
  titleSimilarity,
  entitiesOverlap,
  clusterNews,
} from "./event-cluster";

describe("charBigrams", () => {
  it("strips punctuation and builds bigrams", () => {
    const g = charBigrams("半导体设备");
    expect(g.has("半导")).toBe(true);
    expect(g.has("设备")).toBe(true);
    expect(charBigrams("【快讯】A股").has("a股")).toBe(true); // 标点去除 + 小写
  });
  it("single char returns unigram", () => {
    expect([...charBigrams("茅")]).toEqual(["茅"]);
  });
});

describe("jaccard", () => {
  it("computes intersection over union", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
});

describe("titleSimilarity", () => {
  it("near-duplicate headlines score high, unrelated low", () => {
    const a = "半导体设备板块震荡回升 屹唐股份涨超8%";
    const b = "半导体设备板块震荡回升，屹唐股份涨逾8%";
    expect(titleSimilarity(a, b)).toBeGreaterThan(0.6);
    expect(titleSimilarity(a, "贵州茅台发布年度分红方案")).toBeLessThan(0.2);
  });
});

describe("entitiesOverlap", () => {
  it("overlaps when sharing an id or both empty", () => {
    expect(entitiesOverlap(["x"], ["x", "y"])).toBe(true);
    expect(entitiesOverlap([], [])).toBe(true);
    expect(entitiesOverlap(["x"], ["y"])).toBe(false);
    expect(entitiesOverlap(["x"], [])).toBe(false);
  });
});

describe("clusterNews", () => {
  const base = "2026-07-05T02:00:00Z";
  it("merges near-duplicate same-entity reports in window", () => {
    const clusters = clusterNews([
      { id: "a", title: "中微公司刻蚀设备获大客户重复采购订单", entityIds: ["e1"], publishedAt: base },
      { id: "b", title: "中微公司刻蚀设备再获大客户重复采购订单", entityIds: ["e1"], publishedAt: "2026-07-05T03:00:00Z" },
      { id: "c", title: "贵州茅台披露中期分红预案", entityIds: ["e2"], publishedAt: "2026-07-05T04:00:00Z" },
    ]);
    expect(clusters).toHaveLength(2);
    const big = clusters.find((c) => c.count === 2)!;
    expect(big.memberIds.sort()).toEqual(["a", "b"]);
    expect(big.entityIds).toEqual(["e1"]);
  });
  it("does not merge different entities even with similar titles", () => {
    const clusters = clusterNews([
      { id: "a", title: "季度营收创新高业绩超预期", entityIds: ["e1"], publishedAt: base },
      { id: "b", title: "季度营收创新高业绩超预期", entityIds: ["e2"], publishedAt: base },
    ]);
    expect(clusters).toHaveLength(2);
  });
  it("does not merge same entity beyond the time window", () => {
    const clusters = clusterNews(
      [
        { id: "a", title: "公司获得政府补贴资金", entityIds: ["e1"], publishedAt: base },
        { id: "b", title: "公司获得政府补贴资金", entityIds: ["e1"], publishedAt: "2026-07-08T02:00:00Z" },
      ],
      { windowMs: 24 * 60 * 60 * 1000 },
    );
    expect(clusters).toHaveLength(2);
  });
  it("picks a representative title and counts members", () => {
    const clusters = clusterNews([
      { id: "a", title: "光模块需求超预期订单饱满供不应求", entityIds: ["e1"], publishedAt: base },
      { id: "b", title: "光模块需求超预期订单饱满", entityIds: ["e1"], publishedAt: "2026-07-05T05:00:00Z" },
      { id: "c", title: "光模块需求超预期订单饱满行业景气上行", entityIds: ["e1"], publishedAt: "2026-07-05T06:00:00Z" },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(3);
    expect(clusters[0]!.title).toContain("光模块需求超预期");
  });
});
