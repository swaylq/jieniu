import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("~/server/ai", () => ({
  generateNeutralInterpretation: vi
    .fn()
    .mockResolvedValue("一句话摘要：公司发布公告。中性影响分析：客观陈述。"),
  generatePersonaInterpretation: vi
    .fn()
    .mockResolvedValue("这门生意的本质：稳定。护城河：品牌。"),
  personaName: (k: string) => {
    const m: Record<string, string> = {
      BUFFETT: "巴菲特",
      MUNGER: "查理·芒格",
      LYNCH: "彼得·林奇",
      GRAHAM: "本杰明·格雷厄姆",
    };
    return m[k] ?? k;
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { interpretRouter } from "./interpret";
import {
  generateNeutralInterpretation,
  generatePersonaInterpretation,
} from "~/server/ai";
import { DISCLAIMER } from "~/lib/compliance";
import { __resetRateLimitStore } from "~/lib/rate-limit";

// 生成路径需登录；缓存命中匿名可走。
const SESSION = { user: { id: "u1" } };

function makeCaller(db: unknown, session: unknown = null) {
  const createCaller = createCallerFactory(interpretRouter);
  return createCaller({ db, session, headers: new Headers() } as never);
}

function withNews() {
  return {
    interpretation: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    newsItem: {
      findUnique: vi.fn().mockResolvedValue({
        title: "t",
        summary: "s",
        content: "c",
        source: { name: "src" },
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitStore();
});

describe("interpretRouter.getOrCreate", () => {
  it("returns the cached interpretation without calling the model", async () => {
    const findUnique = vi.fn().mockResolvedValue({ content: "已缓存内容" });
    const res = await makeCaller({ interpretation: { findUnique } }).getOrCreate({
      newsId: "n1",
    });
    expect(res).toEqual({ content: "已缓存内容", cached: true });
    expect(generateNeutralInterpretation).not.toHaveBeenCalled();
  });

  it("generates neutral, appends disclaimer, and caches when missing", async () => {
    const db = withNews();
    const res = await makeCaller(db, SESSION).getOrCreate({ newsId: "n1" });
    expect(res.cached).toBe(false);
    expect(res.content).toContain(DISCLAIMER);
    expect(generateNeutralInterpretation).toHaveBeenCalledTimes(1);
    expect(generatePersonaInterpretation).not.toHaveBeenCalled();
    expect(db.interpretation.create).toHaveBeenCalledTimes(1);
  });

  it("dispatches each persona kind with the right label + disclaimer", async () => {
    const cases = [
      ["BUFFETT", "巴菲特"],
      ["MUNGER", "查理·芒格"],
      ["GRAHAM", "本杰明·格雷厄姆"],
    ] as const;
    for (const [kind, label] of cases) {
      vi.clearAllMocks();
      const db = withNews();
      const res = await makeCaller(db, SESSION).getOrCreate({
        newsId: "n1",
        kind,
      });
      expect(generatePersonaInterpretation).toHaveBeenCalledTimes(1);
      expect(vi.mocked(generatePersonaInterpretation).mock.calls[0]?.[0]).toBe(
        kind,
      );
      expect(generateNeutralInterpretation).not.toHaveBeenCalled();
      expect(res.content).toContain("非投资建议");
      expect(res.content).toContain(label);
    }
  });

  it("requires login to generate an uncached interpretation", async () => {
    const db = withNews();
    await expect(
      makeCaller(db).getOrCreate({ newsId: "n1" }), // 无 session
    ).rejects.toThrow(/登录/);
    expect(generateNeutralInterpretation).not.toHaveBeenCalled();
    expect(db.interpretation.create).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the news does not exist", async () => {
    const db = {
      interpretation: { findUnique: vi.fn().mockResolvedValue(null) },
      newsItem: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      makeCaller(db, SESSION).getOrCreate({ newsId: "nope" }),
    ).rejects.toThrow();
  });
});
