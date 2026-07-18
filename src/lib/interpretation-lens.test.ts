import { describe, it, expect } from "vitest";
import {
  DEFAULT_INTERPRET_LENS,
  MASTER_LENS_KINDS,
  MASTER_LENS_INTRO,
  MASTER_LENS_TOGGLE_LABEL,
  isMasterLens,
  isDefaultLens,
} from "./interpretation-lens";
import { isCompliant } from "./compliance";

describe("interpretation-lens (P5-12 大师视角降级)", () => {
  it("default lens is the neutral objective reading", () => {
    expect(DEFAULT_INTERPRET_LENS).toBe("NEUTRAL");
    expect(isDefaultLens("NEUTRAL")).toBe(true);
    expect(isDefaultLens("BUFFETT")).toBe(false);
  });

  it("masters are the four optional lenses, never the default", () => {
    expect(MASTER_LENS_KINDS).toEqual(["BUFFETT", "MUNGER", "LYNCH", "GRAHAM"]);
    expect(MASTER_LENS_KINDS).not.toContain("NEUTRAL");
    expect(MASTER_LENS_KINDS).toHaveLength(4);
  });

  it("isMasterLens is true for every master and false for neutral", () => {
    for (const k of MASTER_LENS_KINDS) expect(isMasterLens(k)).toBe(true);
    expect(isMasterLens("NEUTRAL")).toBe(false);
  });

  it("default and master partitions are mutually exclusive and exhaustive", () => {
    // every master is not the default, and the default is not a master
    for (const k of MASTER_LENS_KINDS) expect(isDefaultLens(k)).toBe(false);
    expect(isMasterLens(DEFAULT_INTERPRET_LENS)).toBe(false);
  });

  it("master-lens intro frames it as optional / non-advice (compliant, hedged)", () => {
    expect(MASTER_LENS_INTRO).toContain("可选");
    expect(MASTER_LENS_INTRO).toContain("非投资建议");
    // 不作核心品牌承诺：明确是「演示 / 镜头」而非核心结论
    expect(MASTER_LENS_INTRO).toMatch(/演示|镜头|框架/);
    // 合规红线（复用 compliance 扫描）：无买卖/点位/收益承诺
    expect(isCompliant(MASTER_LENS_INTRO)).toBe(true);
  });

  it("toggle label marks the master section as opt-in", () => {
    expect(MASTER_LENS_TOGGLE_LABEL).toContain("可选");
    expect(isCompliant(MASTER_LENS_TOGGLE_LABEL)).toBe(true);
  });
});
