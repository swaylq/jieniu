import { describe, it, expect } from "vitest";
import { parseThesis, asStringArray } from "./thesis";

const sample = {
  summary: "光学元件龙头，盯大客户放量与产能兑现。",
  dimensions: [
    { key: "大客户 / 订单", watch: "核心客户份额与新订单", bull: "拿下新大客户", bear: "大客户砍单" },
    { key: "产能 / 资本开支", watch: "扩产进度与 capex 指引", bull: "扩产如期", bear: "扩产延期" },
  ],
  bullCase: "若大客户放量且产能兑现，营收有望上台阶。",
  bearCase: "若价格战加剧、客户集中度过高，毛利承压。",
  catalysts: ["大客户新一代产品量产落地", "季度毛利率回升"],
  invalidations: ["核心大客户份额被替代", "连续两季现金流转负"],
  keyLevels: "跌破近一年密集成交区需警惕情绪面（观察位，非买卖点）。",
};

describe("parseThesis", () => {
  it("parses a plain JSON object", () => {
    const t = parseThesis(JSON.stringify(sample));
    expect(t.summary).toContain("光学");
    expect(t.dimensions).toHaveLength(2);
    expect(t.dimensions[0]!.key).toBe("大客户 / 订单");
    expect(t.keyLevels).toContain("观察位");
  });

  it("tolerates ```json fences and surrounding prose", () => {
    const raw = "这是框架：\n```json\n" + JSON.stringify(sample) + "\n```\n以上。";
    expect(parseThesis(raw).dimensions).toHaveLength(2);
  });

  it("drops malformed dimensions but keeps valid ones", () => {
    const mixed = { ...sample, dimensions: [...sample.dimensions, { key: "", watch: "" }] };
    expect(parseThesis(JSON.stringify(mixed)).dimensions).toHaveLength(2);
  });

  it("nulls keyLevels when absent", () => {
    const { keyLevels: _drop, ...noLevels } = sample;
    expect(parseThesis(JSON.stringify(noLevels)).keyLevels).toBeNull();
  });

  it("throws when summary or dimensions missing", () => {
    expect(() => parseThesis(JSON.stringify({ summary: "x", dimensions: [] }))).toThrow();
    expect(() => parseThesis("not json at all")).toThrow();
  });

  it("parses catalysts and invalidations (P4-2)", () => {
    const t = parseThesis(JSON.stringify(sample));
    expect(t.catalysts).toEqual(["大客户新一代产品量产落地", "季度毛利率回升"]);
    expect(t.invalidations).toEqual(["核心大客户份额被替代", "连续两季现金流转负"]);
  });

  it("defaults catalysts/invalidations to empty arrays when absent (backward compat)", () => {
    const { catalysts: _c, invalidations: _i, ...bare } = sample;
    const t = parseThesis(JSON.stringify(bare));
    expect(t.catalysts).toEqual([]);
    expect(t.invalidations).toEqual([]);
  });
});

describe("asStringArray", () => {
  it("keeps trimmed non-empty strings, drops junk, empty-safe", () => {
    expect(asStringArray(["  a ", "b", "", 3, null, "  "])).toEqual(["a", "b"]);
    expect(asStringArray(null)).toEqual([]);
    expect(asStringArray("not an array")).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
  });
});
