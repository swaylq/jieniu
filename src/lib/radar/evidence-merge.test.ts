import { describe, it, expect } from "vitest";
import { mergeEvidence, type NewsLite } from "./evidence-merge";

const news = new Map<string, NewsLite>([
  [
    "n1",
    {
      id: "n1",
      title: "关于回购公司股份的进展公告",
      url: "https://x/1",
      publishedAt: new Date("2026-07-30T02:00:00Z"),
      source: { name: "东方财富·公告" },
    },
  ],
]);

const price = [
  {
    id: "commodity:nf_LC0:2026-07-30",
    title: "碳酸锂期货下跌 2.8%，报 140700元/吨",
    url: "https://finance.sina.com.cn/futures/quotes/LC0.shtml",
    sourceName: "新浪期货·主力连续",
    publishedAt: "2026-07-30",
    grade: "MEDIUM" as const,
  },
];

describe("mergeEvidence", () => {
  it("站内证据 external=false，站外证据 external=true", () => {
    const r = mergeEvidence(["n1"], news, price);
    expect(r).toHaveLength(2);
    expect(r[0]!.external).toBe(false);
    expect(r[1]!.external).toBe(true);
    expect(r[1]!.url).toContain("sina");
  });

  it("查不到的站内 id 丢掉，不渲染成空条目", () => {
    const r = mergeEvidence(["n1", "已被清理的id"], news, null);
    expect(r.map((e) => e.id)).toEqual(["n1"]);
  });

  it("站外证据的日期串转成 Date，前台格式化不会拿到字符串", () => {
    const r = mergeEvidence([], news, price);
    expect(r[0]!.publishedAt instanceof Date).toBe(true);
    expect(r[0]!.publishedAt.toISOString().slice(0, 10)).toBe("2026-07-30");
  });

  it("两边都空 → 空数组（不是 null，前台可以直接 .length）", () => {
    expect(mergeEvidence([], news, null)).toEqual([]);
  });
});
