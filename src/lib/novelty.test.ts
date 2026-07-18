import { describe, expect, it } from "vitest";

import { classifyNovelty } from "./novelty";

describe("classifyNovelty", () => {
  it("一手来源 → 原始信息（strong），即便被多家跟进", () => {
    expect(classifyNovelty({ tier: "PRIMARY", clusterCount: 5 })).toMatchObject({
      level: "fresh",
      label: "原始信息",
      tone: "strong",
    });
  });

  it("媒体 + 同事件多篇 → 跟进报道（weak，提示可略读）", () => {
    const r = classifyNovelty({ tier: "MEDIA", clusterCount: 4 });
    expect(r.level).toBe("follow");
    expect(r.label).toBe("跟进报道");
    expect(r.tone).toBe("weak");
    expect(r.hint).toContain("同一事件");
  });

  it("媒体 + 单篇 → 媒体报道", () => {
    expect(classifyNovelty({ tier: "MEDIA", clusterCount: 1 })).toMatchObject({
      level: "coverage",
      tone: "weak",
    });
  });

  it("衍生来源 → 评论解读，与簇大小无关", () => {
    expect(
      classifyNovelty({ tier: "DERIVED", clusterCount: 9 }).level,
    ).toBe("commentary");
    expect(
      classifyNovelty({ tier: "DERIVED", clusterCount: 1 }).level,
    ).toBe("commentary");
  });

  it("缺省 clusterCount 视为 1（媒体单篇）", () => {
    expect(classifyNovelty({ tier: "MEDIA" }).level).toBe("coverage");
  });

  it("只有一手信息给 strong 语气，其余皆 weak（帮用户略过噪声）", () => {
    expect(classifyNovelty({ tier: "PRIMARY" }).tone).toBe("strong");
    expect(classifyNovelty({ tier: "MEDIA", clusterCount: 3 }).tone).toBe("weak");
    expect(classifyNovelty({ tier: "DERIVED" }).tone).toBe("weak");
  });
});
