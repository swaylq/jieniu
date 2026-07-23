import { describe, it, expect, vi, beforeEach } from "vitest";

// Prevent NextAuth from being instantiated through the trpc import chain.
vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

// 自助加股（addStock）依赖的外部行情校验 + 东财代码解析 + 建实体：mock 掉，只测路由编排/守卫。
const fetchQuote = vi.fn<(t: string) => Promise<unknown>>();
const resolveCodeByName = vi.fn<(n: string) => Promise<unknown>>();
const ensureStockEntities = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("~/server/quote", () => ({ fetchQuote: (t: string) => fetchQuote(t) }));
vi.mock("~/server/stocks", () => ({
  resolveCodeByName: (n: string) => resolveCodeByName(n),
  ensureStockEntities: (...a: unknown[]) => ensureStockEntities(...a),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { entityRouter } from "./entity";
import { IMPORTANT_THRESHOLD } from "~/lib/importance";

function makeCaller(db: unknown, session: unknown = null) {
  const createCaller = createCallerFactory(entityRouter);
  return createCaller({ db, session, headers: new Headers() } as never);
}

const SESSION = { user: { id: "u1" } };

describe("entityRouter.getById", () => {
  it("returns null when not found", async () => {
    const db = { entity: { findUnique: vi.fn().mockResolvedValue(null) } };
    expect(await makeCaller(db).getById({ id: "nope" })).toBeNull();
  });

  it("groups relations by direction and type", async () => {
    const db = {
      entity: {
        findUnique: vi.fn().mockResolvedValue({
          id: "c1",
          name: "中芯国际",
          type: "COMPANY",
          ticker: null,
          exchange: null,
          relFrom: [
            { type: "BELONGS_TO", to: { id: "s1", name: "半导体", type: "SECTOR" } },
          ],
          relTo: [
            { type: "WORKS_AT", from: { id: "p1", name: "赵海军", type: "PERSON" } },
          ],
        }),
      },
    };
    const res = await makeCaller(db).getById({ id: "c1" });
    expect(res?.groups.sector).toEqual([{ id: "s1", name: "半导体", type: "SECTOR" }]);
    expect(res?.groups.people).toEqual([{ id: "p1", name: "赵海军", type: "PERSON" }]);
  });
});

describe("entityRouter.search", () => {
  it("returns [] for a blank query without hitting the db", async () => {
    const findMany = vi.fn();
    const res = await makeCaller({ entity: { findMany } }).search({ q: "   " });
    expect(res).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("searches by name/ticker/alias, over-fetches raw for dedup", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: "s1", name: "半导体", type: "SECTOR" }]);
    const res = await makeCaller({ entity: { findMany } }).search({ q: "半导" });
    expect(res).toEqual([{ id: "s1", name: "半导体", type: "SECTOR" }]);
    // 原始 take 提到 40（COMPANY+STOCK 去重后再 slice 到 20），SECTOR 无需查 ISSUES
    const arg = findMany.mock.calls[0]?.[0] as { take: number };
    expect(arg.take).toBe(40);
  });
});

describe("entityRouter.addStock", () => {
  beforeEach(() => {
    fetchQuote.mockReset();
    resolveCodeByName.mockReset();
    ensureStockEntities.mockReset();
  });

  it("requires auth", async () => {
    await expect(
      makeCaller({}, null).addStock({ query: "600519" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects an unrecognizable query before any network call", async () => {
    await expect(
      makeCaller({}, SESSION).addStock({ query: "12345" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(resolveCodeByName).not.toHaveBeenCalled();
    expect(fetchQuote).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when a name can't be resolved to a code", async () => {
    resolveCodeByName.mockResolvedValue(null);
    await expect(
      makeCaller({}, SESSION).addStock({ query: "不存在的公司" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchQuote).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the code has no live quote", async () => {
    fetchQuote.mockResolvedValue(null);
    await expect(
      makeCaller({}, SESSION).addStock({ query: "600519" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchQuote).toHaveBeenCalledWith("600519");
    expect(ensureStockEntities).not.toHaveBeenCalled();
  });

  it("rejects ST / delisting / index-fund names (not seedable)", async () => {
    fetchQuote.mockResolvedValue({
      name: "ST生物",
      price: 3,
      prevClose: 3,
      open: 3,
      high: 3,
      low: 3,
      changePct: 0,
    });
    await expect(
      makeCaller({}, SESSION).addStock({ query: "600519" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ensureStockEntities).not.toHaveBeenCalled();
  });

  it("creates the entity (user-add meta) and follows it on the happy path", async () => {
    resolveCodeByName.mockResolvedValue("600519");
    fetchQuote.mockResolvedValue({
      name: "贵州茅台",
      price: 1500,
      prevClose: 1490,
      open: 1495,
      high: 1510,
      low: 1488,
      changePct: 0.67,
    });
    ensureStockEntities.mockResolvedValue({ companyId: "c1", created: true });
    const upsert = vi.fn().mockResolvedValue({});
    const res = await makeCaller({ watchlist: { upsert } }, SESSION).addStock({
      query: "贵州茅台",
    });
    expect(res).toEqual({ companyId: "c1", name: "贵州茅台", ticker: "600519" });
    // 幂等加自选到规范 COMPANY
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_entityId: { userId: "u1", entityId: "c1" } },
        create: { userId: "u1", entityId: "c1" },
      }),
    );
    // 建实体带 user-add 来源标记（含 addedBy）
    expect(ensureStockEntities).toHaveBeenCalledWith(
      expect.anything(),
      "贵州茅台",
      "600519",
      expect.objectContaining({ source: "user-add", addedBy: "u1" }),
    );
  });
});

describe("entityRouter.followerCount", () => {
  it("counts watchlist rows for the entity", async () => {
    const count = vi.fn().mockResolvedValue(42);
    const res = await makeCaller({ watchlist: { count } }).followerCount({
      id: "e1",
    });
    expect(res).toBe(42);
    expect(count).toHaveBeenCalledWith({ where: { entityId: "e1" } });
  });
});

describe("entityRouter.newsById", () => {
  it("queries news linked to the entity, newest first", async () => {
    const rows = [{ id: "n1", title: "某公司停牌", tier: "PRIMARY", importance: 90 }];
    const findMany = vi.fn().mockResolvedValue(rows);
    const res = await makeCaller({ newsItem: { findMany } }).newsById({ id: "c1" });
    expect(res).toEqual(rows);
    const arg = findMany.mock.calls[0]?.[0] as { where: unknown; take: number };
    expect(arg.where).toEqual({ entities: { some: { entityId: "c1" } } });
    // 多取供同日公告轰炸折叠(collapseAnnouncementBursts)用，露出被淹的其它动态。
    // 一年回填后每家上百条，60 条只够看两个月，故提到 120。
    expect(arg.take).toBe(120);
  });
});

describe("entityRouter.milestones", () => {
  it("只取重磅事件、限定近 N 个月、按发布时间倒序", async () => {
    const rows = [{ id: "n1", title: "签订重大合同", importance: 65 }];
    const findMany = vi.fn().mockResolvedValue(rows);
    const res = await makeCaller({ newsItem: { findMany } }).milestones({
      id: "c1",
      months: 12,
    });
    expect(res).toEqual(rows);
    const arg = findMany.mock.calls[0]?.[0] as {
      where: {
        entities: unknown;
        importance: { gte: number };
        publishedAt: { gte: Date };
      };
      orderBy: unknown;
      take: number;
    };
    expect(arg.where.entities).toEqual({ some: { entityId: "c1" } });
    // 重磅线：例行治理公告进不来，回填一年也不会糊墙
    expect(arg.where.importance.gte).toBe(IMPORTANT_THRESHOLD);
    expect(arg.orderBy).toEqual([{ publishedAt: "desc" }]);
    expect(arg.take).toBe(200);

    // 起点应落在约 12 个月前（允许月份长度差异，用天数区间断言）
    const days =
      (Date.now() - arg.where.publishedAt.gte.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(355);
    expect(days).toBeLessThan(375);
  });

  it("months 默认 12", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await makeCaller({ newsItem: { findMany } }).milestones({ id: "c1" });
    const arg = findMany.mock.calls[0]?.[0] as {
      where: { publishedAt: { gte: Date } };
    };
    const days =
      (Date.now() - arg.where.publishedAt.gte.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(355);
  });
});

describe("entityRouter.newsPage", () => {
  it("按 tier 直接分页取公告（不是在资讯里筛），并返回两个 tab 的总数", async () => {
    const rows = [{ id: "n1", title: "回购进展", tier: "PRIMARY" }];
    const findMany = vi.fn().mockResolvedValue(rows);
    const count = vi
      .fn()
      .mockResolvedValueOnce(352) // 资讯总数
      .mockResolvedValueOnce(240); // 公告总数
    const res = await makeCaller({
      newsItem: { findMany, count },
    }).newsPage({ id: "c1", tab: "announce", page: 3, perPage: 40 });

    expect(res.newsTotal).toBe(352);
    expect(res.announceTotal).toBe(240);
    expect(res.page).toBe(3);
    expect(res.pages).toBe(6); // ceil(240/40)
    expect(res.items).toEqual(rows);

    const arg = findMany.mock.calls[0]?.[0] as {
      where: { tier?: string };
      skip: number;
      take: number;
      orderBy: unknown;
    };
    expect(arg.where.tier).toBe("PRIMARY");
    expect(arg.skip).toBe(80);
    expect(arg.take).toBe(40);
    expect(arg.orderBy).toEqual([{ publishedAt: "desc" }, { id: "desc" }]);
  });

  it("资讯 tab 不加 tier 过滤，页数按资讯总数算", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValueOnce(90).mockResolvedValueOnce(30);
    const res = await makeCaller({ newsItem: { findMany, count } }).newsPage({
      id: "c1",
      perPage: 40,
    });
    const arg = findMany.mock.calls[0]?.[0] as { where: { tier?: string } };
    expect(arg.where.tier).toBeUndefined();
    expect(res.pages).toBe(3); // ceil(90/40)
  });

  it("没有任何资讯时页数仍为 1（不出现 0 页）", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const res = await makeCaller({ newsItem: { findMany, count } }).newsPage({
      id: "c1",
    });
    expect(res.pages).toBe(1);
  });
});

describe("entityRouter.listByTypePage", () => {
  it("分页浏览全部公司", async () => {
    const items = [{ id: "e1", name: "宁德时代", ticker: null }];
    const findMany = vi.fn().mockResolvedValue(items);
    const count = vi.fn().mockResolvedValue(802);
    const res = await makeCaller({ entity: { findMany, count } }).listByTypePage(
      { type: "COMPANY", page: 2, perPage: 120 },
    );
    expect(res.total).toBe(802);
    expect(res.pages).toBe(7); // ceil(802/120)
    const arg = findMany.mock.calls[0]?.[0] as { skip: number; take: number };
    expect(arg.skip).toBe(120);
    expect(arg.take).toBe(120);
  });
});
