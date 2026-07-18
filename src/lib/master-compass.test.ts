import { describe, it, expect } from "vitest";
import { masterCompass, MASTER_ORDER, strongMasters } from "./master-compass";

const score = (t: string, k: string) =>
  masterCompass({ title: t }).entries.find((e) => e.kind === k)!.score;

describe("masterCompass", () => {
  it("returns the four masters in a fixed order", () => {
    const c = masterCompass({ title: "某公司公告" });
    expect(c.entries.map((e) => e.kind)).toEqual(MASTER_ORDER);
  });

  it("scores are bounded to [baseline, 100] and equal baseline with no signals", () => {
    const c = masterCompass({ title: "某公司发布日常运营公告" });
    for (const e of c.entries) {
      expect(e.score).toBeGreaterThanOrEqual(30);
      expect(e.score).toBeLessThanOrEqual(100);
    }
    // no signal words → all equal (baseline)
    const uniq = new Set(c.entries.map((e) => e.score));
    expect(uniq.size).toBe(1);
  });

  it("lifts BUFFETT for moat / acquisition news", () => {
    const t = "A公司拟收购B公司，巩固护城河与品牌龙头地位";
    expect(score(t, "BUFFETT")).toBeGreaterThan(score(t, "LYNCH"));
    expect(score(t, "BUFFETT")).toBeGreaterThan(50);
  });

  it("lifts MUNGER for risk / regulatory news", () => {
    const t = "C公司因涉嫌信息披露违规被证监会立案，涉诉讼";
    expect(score(t, "MUNGER")).toBeGreaterThan(score(t, "BUFFETT"));
  });

  it("lifts LYNCH for growth news", () => {
    const t = "D公司业绩预增，新产品订单放量、产能扩张";
    expect(score(t, "LYNCH")).toBeGreaterThan(score(t, "GRAHAM"));
  });

  it("lifts GRAHAM for distress / valuation news", () => {
    const t = "E公司预计重整，债务违约、大额亏损，净资产承压";
    expect(score(t, "GRAHAM")).toBeGreaterThan(score(t, "LYNCH"));
  });

  it("headline flags routine news when nothing is strong", () => {
    expect(masterCompass({ title: "公司发布日常公告" }).headline).toContain(
      "常规",
    );
  });

  it("headline names the focused master on divergence", () => {
    const h = masterCompass({
      title: "A公司拟收购B公司巩固护城河",
    }).headline;
    expect(h).toContain("巴菲特");
  });

  it("strongMasters lists the relevant lenses for a news item", () => {
    expect(strongMasters({ title: "A公司拟收购B公司巩固护城河" })).toContain(
      "BUFFETT",
    );
    expect(strongMasters({ title: "公司发布日常公告" })).toEqual([]);
  });

  it("never yields a directional / buy-sell field", () => {
    // 结构上就没有方向性字段：只有 kind / score / focus
    const e = masterCompass({ title: "收购护城河" }).entries[0]!;
    expect(Object.keys(e).sort()).toEqual(["focus", "kind", "score"]);
  });
});
