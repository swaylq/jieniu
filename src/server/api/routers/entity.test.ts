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
    expect(arg.take).toBe(60);
  });
});
