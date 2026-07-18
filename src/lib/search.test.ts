import { describe, it, expect } from "vitest";
import { dedupeSearchResults, type SearchHit, type IssueLink } from "./search";

const co: SearchHit = { id: "co1", name: "贵州茅台", type: "COMPANY", ticker: null };
const st: SearchHit = { id: "st1", name: "贵州茅台(600519)", type: "STOCK", ticker: "600519" };
const link: IssueLink = { companyId: "co1", company: co, stockId: "st1", stockTicker: "600519" };

describe("dedupeSearchResults", () => {
  it("collapses COMPANY + its STOCK into one COMPANY row with ticker", () => {
    const out = dedupeSearchResults([co, st], [link]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "co1", name: "贵州茅台", type: "COMPANY", ticker: "600519" });
  });

  it("resolves a ticker-only STOCK match to its COMPANY (搜代码也进公司页)", () => {
    // 搜「600519」只命中 STOCK，但应返回 COMPANY
    const out = dedupeSearchResults([st], [link]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "co1", type: "COMPANY", ticker: "600519" });
  });

  it("attaches ticker to a COMPANY-only match", () => {
    const out = dedupeSearchResults([co], [link]);
    expect(out[0]).toMatchObject({ id: "co1", ticker: "600519" });
  });

  it("keeps orphan STOCK (no owning COMPANY)", () => {
    const orphan: SearchHit = { id: "st9", name: "某退市股(000000)", type: "STOCK", ticker: "000000" };
    const out = dedupeSearchResults([orphan], []);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("st9");
  });

  it("passes SECTOR / PERSON through unchanged and preserves order", () => {
    const sector: SearchHit = { id: "se1", name: "白酒", type: "SECTOR", ticker: null };
    const person: SearchHit = { id: "pe1", name: "张三", type: "PERSON", ticker: null };
    const out = dedupeSearchResults([sector, co, st, person], [link]);
    expect(out.map((e) => e.id)).toEqual(["se1", "co1", "pe1"]);
  });

  it("dedups when STOCK appears before its COMPANY", () => {
    const out = dedupeSearchResults([st, co], [link]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "co1", ticker: "600519" });
  });
});
