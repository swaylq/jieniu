import { describe, expect, it } from "vitest";

import { rankAttentionRadar } from "./opportunity";

const row = (over: Partial<Parameters<typeof rankAttentionRadar>[0][number]>) => ({
  entityId: "e",
  name: "X",
  ticker: null,
  type: "COMPANY",
  total: 10,
  primary: 5,
  ...over,
});

describe("rankAttentionRadar", () => {
  it("剔除资讯量不足(<RADAR_MIN_TOTAL=3)的标的", () => {
    const out = rankAttentionRadar([row({ total: 2, primary: 2 })], 10);
    expect(out).toHaveLength(0);
  });

  it("一手占比高 → 有原始进展 (amber/up)", () => {
    const [r] = rankAttentionRadar([row({ total: 10, primary: 7 })], 10);
    expect(r.flagLabel).toBe("有原始进展");
    expect(r.flagTone).toBe("up");
    expect(r.lowNovelty).toBe(false);
  });

  it("一手占比低 → 多为跟进报道 = 高关注低新信息 (neutral)", () => {
    const [r] = rankAttentionRadar([row({ total: 20, primary: 2 })], 10);
    expect(r.flagLabel).toBe("多为跟进报道");
    expect(r.flagTone).toBe("neutral");
    expect(r.lowNovelty).toBe(true);
    expect(r.hint).toContain("情绪");
  });

  it("中间占比 → 关注升温", () => {
    const [r] = rankAttentionRadar([row({ total: 10, primary: 4 })], 10);
    expect(r.flagLabel).toBe("关注升温");
    expect(r.lowNovelty).toBe(false);
  });

  it("按资讯量降序，再按一手占比降序；take 截断", () => {
    const out = rankAttentionRadar(
      [
        row({ entityId: "a", total: 5, primary: 3 }),
        row({ entityId: "b", total: 20, primary: 1 }),
        row({ entityId: "c", total: 20, primary: 15 }),
      ],
      2,
    );
    expect(out.map((r) => r.entityId)).toEqual(["c", "b"]); // 20/高一手, 20/低一手
    expect(out).toHaveLength(2);
  });

  it("flag 配色不含红绿（铁律）", () => {
    const out = rankAttentionRadar(
      [row({ total: 10, primary: 8 }), row({ total: 10, primary: 1 })],
      10,
    );
    for (const r of out) expect(r.flagTone).toMatch(/^(up|neutral)$/);
  });
});
