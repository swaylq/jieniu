import { describe, it, expect } from "vitest";
import {
  isMaterialCandidate,
  dimensionKeywords,
  candidateDimensions,
  parseSignals,
} from "./thesis-match";
import type { ThesisDimension } from "./thesis";

const dims: ThesisDimension[] = [
  { key: "产能 / 扩产", watch: "产能利用率、新产线爬坡", bull: "扩产如期", bear: "延期" },
  { key: "大客户", watch: "核心客户份额、订单", bull: "拿单", bear: "砍单" },
];

describe("isMaterialCandidate (Gate 1)", () => {
  it("passes 一手公告 (PRIMARY) even at modest importance", () => {
    expect(isMaterialCandidate({ importance: 45, eventType: null, tier: "PRIMARY" })).toBe(true);
  });
  it("passes 重磅 media news", () => {
    expect(isMaterialCandidate({ importance: 60, eventType: null, tier: "MEDIA" })).toBe(true);
  });
  it("passes news with an eventType even if low importance", () => {
    expect(isMaterialCandidate({ importance: 20, eventType: "重组", tier: "MEDIA" })).toBe(true);
  });
  it("blocks routine low-importance media chatter", () => {
    expect(isMaterialCandidate({ importance: 20, eventType: null, tier: "MEDIA" })).toBe(false);
  });
});

describe("dimensionKeywords / candidateDimensions (Gate 2)", () => {
  it("splits key+watch into ≥2-char keywords", () => {
    expect(dimensionKeywords(dims[0]!)).toContain("产能利用率");
    expect(dimensionKeywords(dims[1]!)).toContain("订单");
  });
  it("finds dimensions whose keyword appears in the news text", () => {
    const hit = candidateDimensions(dims, "公司公告：核心客户份额提升，新增订单");
    expect(hit.map((d) => d.key)).toEqual(["大客户"]);
  });
  it("returns empty when nothing overlaps", () => {
    expect(candidateDimensions(dims, "无关的天气新闻")).toEqual([]);
  });
});

describe("parseSignals", () => {
  const keys = ["产能 / 扩产", "大客户"];
  it("keeps valid signals and clamps materiality", () => {
    const raw = JSON.stringify([
      { dimensionKey: "大客户", direction: "bull", materiality: 120, note: "拿下新大客户" },
      { dimensionKey: "产能 / 扩产", direction: "bear", materiality: 40, note: "扩产延期" },
    ]);
    const out = parseSignals(raw, keys);
    expect(out).toHaveLength(2);
    expect(out[0]!.materiality).toBe(100);
    expect(out[1]!.direction).toBe("bear");
  });
  it("drops signals with unknown dimensionKey or bad direction or empty note", () => {
    const raw = JSON.stringify([
      { dimensionKey: "不存在", direction: "bull", materiality: 50, note: "x" },
      { dimensionKey: "大客户", direction: "up", materiality: 50, note: "y" },
      { dimensionKey: "大客户", direction: "bull", materiality: 50, note: "" },
      { dimensionKey: "大客户", direction: "neutral", materiality: 30, note: "有效" },
    ]);
    const out = parseSignals(raw, keys);
    expect(out).toHaveLength(1);
    expect(out[0]!.note).toBe("有效");
  });
  it("tolerates ```json fences", () => {
    const raw = "```json\n" + JSON.stringify([{ dimensionKey: "大客户", direction: "bull", materiality: 70, note: "n" }]) + "\n```";
    expect(parseSignals(raw, keys)).toHaveLength(1);
  });
});
