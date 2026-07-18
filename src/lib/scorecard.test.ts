import { describe, it, expect } from "vitest";
import {
  percentileRank,
  levelOf,
  buildScorecard,
} from "./scorecard";

describe("percentileRank", () => {
  it("is 100 when value is the max of the set", () => {
    expect(percentileRank(9, [1, 2, 3, 9])).toBe(100);
  });
  it("is low when value is near the bottom", () => {
    expect(percentileRank(1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(10);
  });
  it("returns 0 for an empty peer set", () => {
    expect(percentileRank(5, [])).toBe(0);
  });
});

describe("levelOf", () => {
  it("maps score to 高/中/低", () => {
    expect(levelOf(80)).toBe("高");
    expect(levelOf(50)).toBe("中");
    expect(levelOf(10)).toBe("低");
  });
});

describe("buildScorecard", () => {
  it("computes the three news/attention dimensions", () => {
    const c = buildScorecard({
      news30d: 12,
      hot30d: 6,
      peerNews30d: [1, 2, 3, 12],
      focusMasters: 2,
    });
    expect(c.entries.map((e) => e.key)).toEqual(["heat", "hot", "focus"]);
    expect(c.entries[0]!.score).toBe(100); // 12 is max of peers
    expect(c.entries[1]!.score).toBe(50); // 6/12
    expect(c.entries[2]!.score).toBe(50); // 2/4
  });

  it("flags an empty-coverage entity in the headline", () => {
    const c = buildScorecard({
      news30d: 0,
      hot30d: 0,
      peerNews30d: [3, 5, 8],
      focusMasters: 0,
    });
    expect(c.headline).toContain("暂无资讯覆盖");
    expect(c.entries[1]!.score).toBe(0); // no divide-by-zero
  });

  it("names the standout dimension when a level is 高", () => {
    const c = buildScorecard({
      news30d: 20,
      hot30d: 20,
      peerNews30d: [1, 20],
      focusMasters: 4,
    });
    expect(c.headline).toContain("资讯活跃");
    expect(c.entries.every((e) => e.score === 100)).toBe(true);
  });
});
