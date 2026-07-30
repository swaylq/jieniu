import { describe, it, expect, vi } from "vitest";

import { hotStockTargets } from "./backfill-targets";

// 热门股定向刷新（QA loop run 7 backlog，run 44 sway 授权执行）：report/media-refresh 原只用 targetsByNeed
// （绑定最少优先=冷尾），热门股永不入选、其每日新研报/媒体被系统性漏采。hotStockTargets 补齐：
// 取近 N 天资讯最多的 top-K 股，与冷尾并行刷新。热度按 STOCK 及其发行 COMPANY 的近期资讯数合计。
describe("hotStockTargets", () => {
  function makeDb() {
    return {
      entity: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sA", name: "甲公司(600001)", ticker: "600001" },
          { id: "sB", name: "乙公司(600002)", ticker: "600002" },
          { id: "sC", name: "丙公司(600003)", ticker: "600003" },
        ]),
      },
      entityRelation: {
        // 公司 cA 发行股票 sA（sA 的热度应含 cA 的资讯）
        findMany: vi.fn().mockResolvedValue([{ fromId: "cA", toId: "sA" }]),
      },
      newsEntity: {
        groupBy: vi.fn().mockResolvedValue([
          { entityId: "sA", _count: { entityId: 3 } },
          { entityId: "cA", _count: { entityId: 2 } }, // sA 合计热度 = 3+2 = 5
          { entityId: "sC", _count: { entityId: 10 } }, // sC 热度 = 10
          // sB 近期无资讯 → 热度 0 → 应被过滤
        ]),
      },
    } as never;
  }

  it("按近期资讯热度降序取 top-K，热度 0 的股被过滤，名字去括号代码", async () => {
    const res = await hotStockTargets(makeDb(), 5);
    expect(res.map((t) => t.code)).toEqual(["600003", "600001"]); // C(10) > A(5)；B(0) 过滤
    expect(res[0]!.name).toBe("丙公司");
    expect(res[1]!.entityIds).toContain("sA");
    expect(res[1]!.entityIds).toContain("cA"); // 含发行公司
  });

  it("尊重 k 上限", async () => {
    const res = await hotStockTargets(makeDb(), 1);
    expect(res.map((t) => t.code)).toEqual(["600003"]);
  });
});
