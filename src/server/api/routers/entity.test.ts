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
            {
              type: "BELONGS_TO",
              to: { id: "s1", name: "半导体", type: "SECTOR" },
            },
          ],
          relTo: [
            {
              type: "WORKS_AT",
              from: { id: "p1", name: "赵海军", type: "PERSON" },
            },
          ],
        }),
      },
    };
    const res = await makeCaller(db).getById({ id: "c1" });
    expect(res?.groups.sector).toEqual([
      { id: "s1", name: "半导体", type: "SECTOR" },
    ]);
    expect(res?.groups.people).toEqual([
      { id: "p1", name: "赵海军", type: "PERSON" },
    ]);
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
    const res = await makeCaller({ entity: { findMany } }).search({
      q: "半导",
    });
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
    expect(res).toEqual({
      companyId: "c1",
      name: "贵州茅台",
      ticker: "600519",
    });
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
    const rows = [
      { id: "n1", title: "某公司停牌", tier: "PRIMARY", importance: 90 },
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const res = await makeCaller({ newsItem: { findMany } }).newsById({
      id: "c1",
    });
    expect(res).toEqual(rows);
    const arg = findMany.mock.calls[0]?.[0] as { where: unknown; take: number };
    expect(arg.where).toEqual({ entities: { some: { entityId: "c1" } } });
    // 多取供同日公告轰炸折叠(collapseAnnouncementBursts)用，露出被淹的其它动态。
    // 一年回填后每家上百条，60 条只够看两个月，故提到 120。
    expect(arg.take).toBe(120);
  });
});

describe("entityRouter.milestones", () => {
  it("只取重磅事件、限定近 N 个月、按 importance desc 取全年最重磅 200", async () => {
    const rows = [{ id: "n1", title: "签订重大合同", importance: 65 }];
    const findMany = vi.fn().mockResolvedValue(rows);
    // total 走独立 count()：热门板块一年可达数百条，take:200 截断，total 给真实总数（QA loop run 10 维度 b）。
    const count = vi.fn().mockResolvedValue(740);
    const res = await makeCaller({ newsItem: { findMany, count } }).milestones({
      id: "c1",
      months: 12,
    });
    expect(res).toEqual({ items: rows, total: 740 });
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
    // 取「全年最重磅 200」跨月呈现，而非「最近 200」（否则热门板块坍缩到本月，run 44 修）。
    expect(arg.orderBy).toEqual([
      { importance: "desc" },
      { publishedAt: "desc" },
    ]);
    expect(arg.take).toBe(200);
    // count 用同一 where（真实总数，不受 take 限制）
    const countArg = count.mock.calls[0]?.[0] as {
      where: { importance: { gte: number } };
    };
    expect(countArg.where.importance.gte).toBe(IMPORTANT_THRESHOLD);

    // 起点应落在约 12 个月前（允许月份长度差异，用天数区间断言）
    const days =
      (Date.now() - arg.where.publishedAt.gte.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(355);
    expect(days).toBeLessThan(375);
  });

  it("months 默认 12", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    await makeCaller({ newsItem: { findMany, count } }).milestones({
      id: "c1",
    });
    const arg = findMany.mock.calls[0]?.[0] as {
      where: { publishedAt: { gte: Date } };
    };
    const days =
      (Date.now() - arg.where.publishedAt.gte.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(355);
  });
});

describe("entityRouter.newsPage", () => {
  // 判「这条是不是这家公司自己的事」要拿它的全部身份（COMPANY 与它 ISSUES 的 STOCK 是两个实体，
  // 名字/代码分散在两侧），所以 newsPage 会先取一次实体。
  const ENTITY = {
    name: "国盾量子",
    shortName: null,
    aliases: [],
    ticker: null,
    relFrom: [
      {
        to: {
          name: "国盾量子(688027)",
          shortName: null,
          aliases: [],
          ticker: "688027",
        },
      },
    ],
    relTo: [],
  };
  const entityDb = () => ({ findUnique: vi.fn().mockResolvedValue(ENTITY) });
  /** count 的调用顺序：资讯总数 → 自有总数 → 公告总数 → 研报总数 */
  const counts = (all: number, own: number, ann: number, rep: number) =>
    vi
      .fn()
      .mockResolvedValueOnce(all)
      .mockResolvedValueOnce(own)
      .mockResolvedValueOnce(ann)
      .mockResolvedValueOnce(rep);

  it("按 tier 直接分页取公告（不是在资讯里筛），并返回各 tab 的总数", async () => {
    const rows = [
      {
        id: "n1",
        title: "回购进展",
        tier: "PRIMARY",
        source: { name: "巨潮资讯·公告", kind: "official-filing" },
      },
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const res = await makeCaller({
      newsItem: { findMany, count: counts(352, 300, 240, 18) },
      entity: entityDb(),
    }).newsPage({ id: "c1", tab: "announce", page: 3, perPage: 40 });

    expect(res.newsTotal).toBe(352);
    expect(res.ownTotal).toBe(300);
    expect(res.announceTotal).toBe(240);
    expect(res.page).toBe(3);
    expect(res.pages).toBe(6); // ceil(240/40)
    expect(res.items).toEqual([
      {
        id: "n1",
        title: "回购进展",
        tier: "PRIMARY",
        source: { name: "巨潮资讯·公告" },
        own: true, // 一手公告：来源体裁已定主体，标题不带公司名也算自有
      },
    ]);

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

  it("资讯 tab 默认全量口径：不加 tier、不加主体过滤，页数按资讯总数算", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const res = await makeCaller({
      newsItem: { findMany, count: counts(90, 40, 30, 12) },
      entity: entityDb(),
    }).newsPage({ id: "c1", perPage: 40 });
    const arg = findMany.mock.calls[0]?.[0] as {
      where: { tier?: string; OR?: unknown };
    };
    expect(arg.where.tier).toBeUndefined();
    expect(arg.where.OR).toBeUndefined();
    expect(res.pages).toBe(3); // ceil(90/40)
    // 研报数随每次取页返回——一致预期卡靠它决定给不给「看研报」入口
    expect(res.reportTotal).toBe(12);
  });

  it("scope=own：标题命中任一身份 或 来源体裁权威，页数按自有总数算", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const res = await makeCaller({
      newsItem: { findMany, count: counts(90, 40, 30, 12) },
      entity: entityDb(),
    }).newsPage({ id: "c1", scope: "own", perPage: 40 });
    const arg = findMany.mock.calls[0]?.[0] as {
      where: { OR: { title?: { contains: string }; source?: unknown }[] };
    };
    const titles = arg.where.OR.flatMap((c) =>
      c.title ? [c.title.contains] : [],
    );
    // COMPANY 与 STOCK 两侧的名字/代码都要进 where，缺一侧就会把那一半资讯筛掉
    expect(titles).toContain("国盾量子");
    expect(titles).toContain("688027");
    expect(arg.where.OR.some((c) => c.source)).toBe(true);
    expect(res.pages).toBe(1); // ceil(40/40)
  });

  it("媒体稿标题没点名 → own=false，卡片据此打「仅提及」", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "n1",
        title: "A股最大“肉签”诞生！中一签最高赚55.65万元",
        tier: "MEDIA",
        source: { name: "东方财富·个股资讯", kind: "json-api" },
      },
      {
        id: "n2",
        title: "国盾量子获纳入上证科创板50成份指数",
        tier: "MEDIA",
        source: { name: "东方财富·个股资讯", kind: "json-api" },
      },
    ]);
    const res = await makeCaller({
      newsItem: { findMany, count: counts(90, 40, 30, 12) },
      entity: entityDb(),
    }).newsPage({ id: "c1" });
    expect(res.items.map((i) => i.own)).toEqual([false, true]);
  });

  it("研报 tab 按 eventType 取（不按源），页数按研报总数算", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const res = await makeCaller({
      newsItem: { findMany, count: counts(90, 40, 30, 71) },
      entity: entityDb(),
    }).newsPage({ id: "c1", tab: "report", perPage: 40 });
    const arg = findMany.mock.calls[0]?.[0] as {
      where: { tier?: string; eventType?: string };
    };
    expect(arg.where.eventType).toBe("研报");
    expect(arg.where.tier).toBeUndefined(); // 研报多是 MEDIA 源，按 tier 筛会全丢
    expect(res.reportTotal).toBe(71);
    expect(res.pages).toBe(2); // ceil(71/40)
  });

  it("没有任何资讯时页数仍为 1（不出现 0 页）", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const res = await makeCaller({
      newsItem: { findMany, count },
      entity: entityDb(),
    }).newsPage({ id: "c1" });
    expect(res.pages).toBe(1);
  });
});

describe("entityRouter.listByTypePage", () => {
  it("分页浏览全部公司", async () => {
    const items = [{ id: "e1", name: "宁德时代", ticker: null }];
    const findMany = vi.fn().mockResolvedValue(items);
    const count = vi.fn().mockResolvedValue(802);
    const res = await makeCaller({
      entity: { findMany, count },
    }).listByTypePage({ type: "COMPANY", page: 2, perPage: 120 });
    expect(res.total).toBe(802);
    expect(res.pages).toBe(7); // ceil(802/120)
    const arg = findMany.mock.calls[0]?.[0] as { skip: number; take: number };
    expect(arg.skip).toBe(120);
    expect(arg.take).toBe(120);
  });
});

// 大事记「一年脉络」修（QA loop run 44，sway 授权执行 run 37 backlog）：
// 原按 publishedAt desc 取最近 200 → 热门板块（医药 740 条/年）最近 200 全落在本月，"一年脉络"坍缩。
// 改按 importance desc 取「全年最重磅 200」跨月呈现；取到后再按时间倒序喂 groupByMonth（保月内时序）。
describe("entityRouter.milestones 一年脉络", () => {
  it("按 importance desc 取全年最重磅（非最近），返回项再按 publishedAt 倒序", async () => {
    const rows = [
      {
        id: "a",
        publishedAt: new Date("2026-01-15T00:00:00Z"),
        importance: 90,
      },
      {
        id: "b",
        publishedAt: new Date("2026-07-10T00:00:00Z"),
        importance: 80,
      },
      {
        id: "c",
        publishedAt: new Date("2026-03-20T00:00:00Z"),
        importance: 70,
      },
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const count = vi.fn().mockResolvedValue(740);
    const res = await makeCaller({ newsItem: { findMany, count } }).milestones({
      id: "e1",
    });
    const arg = findMany.mock.calls[0]?.[0] as {
      orderBy: unknown;
      take: number;
    };
    expect(arg.orderBy).toEqual([
      { importance: "desc" },
      { publishedAt: "desc" },
    ]);
    expect(arg.take).toBe(200);
    // 展示顺序按时间倒序：2026-07(b) > 2026-03(c) > 2026-01(a)
    expect(res.items.map((i: { id: string }) => i.id)).toEqual(["b", "c", "a"]);
    expect(res.total).toBe(740);
  });
});
