import { z } from "zod";
import { TRPCError } from "@trpc/server";

import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
} from "~/server/api/trpc";
import { groupRelations, type GraphRelation } from "~/lib/entity-graph";
import { IMPORTANT_THRESHOLD, surfacingSince } from "~/lib/importance";
import { selectPeers } from "~/lib/ecosystem";
import { strongMasters } from "~/lib/master-compass";
import { buildScorecard } from "~/lib/scorecard";
import { rankAttentionRadar, type AttentionRow } from "~/lib/opportunity";
import { HOT_SECTOR_NAMES, hotSectorOrder } from "~/lib/hot-universe";
import { dedupeSearchResults } from "~/lib/search";
import { classifyStockQuery, normalizeStockName } from "~/lib/add-stock";
import { isSeedableStock } from "~/lib/universe";
import { fetchQuote } from "~/server/quote";
import { resolveCodeByName, ensureStockEntities } from "~/server/stocks";

export const entityRouter = createTRPCRouter({
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const entity = await ctx.db.entity.findUnique({
        where: { id: input.id },
        include: {
          relFrom: { include: { to: true } },
          relTo: { include: { from: true } },
        },
      });
      if (!entity) return null;

      const rels: GraphRelation[] = [
        ...entity.relFrom.map((r) => ({
          type: r.type,
          direction: "out" as const,
          entity: {
            id: r.to.id,
            name: r.to.name,
            type: r.to.type,
            ticker: r.to.ticker,
          },
        })),
        ...entity.relTo.map((r) => ({
          type: r.type,
          direction: "in" as const,
          entity: {
            id: r.from.id,
            name: r.from.name,
            type: r.from.type,
            ticker: r.from.ticker,
          },
        })),
      ];

      return { entity, groups: groupRelations(rels) };
    }),

  /** 实体的投资逻辑框架（Phase 3 · AI 生成、共享缓存）。无则 null。 */
  thesis: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.thesis.findUnique({ where: { entityId: input.id } }),
    ),

  /** 触及该实体投资逻辑维度的信号（Phase 3 P3-3），按材料度×时间。供 thesis 卡显示"近期命中"。 */
  thesisSignals: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.thesisSignal.findMany({
        where: { entityId: input.id },
        orderBy: [{ materiality: "desc" }, { publishedAt: "desc" }],
        take: 40,
        select: {
          dimensionKey: true,
          direction: true,
          materiality: true,
          note: true,
          newsTitle: true,
          newsId: true,
          publishedAt: true,
        },
      }),
    ),

  /** 覆盖图谱（Phase 3 P3-5）：公司所属行业 + 同板块竞品，及各自近期资讯，把生态纳入监控视野。 */
  ecosystem: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const secRels = await ctx.db.entityRelation.findMany({
        where: { fromId: input.id, type: "BELONGS_TO", to: { type: "SECTOR" } },
        select: { to: { select: { id: true, name: true } } },
      });
      const sectors = secRels.map((r) => r.to);
      const sectorIds = sectors.map((s) => s.id);
      if (sectorIds.length === 0) {
        return { sectors, peers: [], sectorNews: [], peerNews: [] };
      }

      const memberRels = await ctx.db.entityRelation.findMany({
        where: {
          toId: { in: sectorIds },
          type: "BELONGS_TO",
          from: { type: "COMPANY" },
        },
        select: { from: { select: { id: true, name: true, ticker: true } } },
        take: 60,
      });
      const peers = selectPeers(
        input.id,
        memberRels.map((r) => r.from),
        8,
      );
      const peerIds = peers.map((p) => p.id);

      const newsSelect = {
        id: true,
        title: true,
        url: true,
        tier: true,
        importance: true,
        publishedAt: true,
        source: { select: { name: true } },
      } as const;

      const [sectorNews, peerNewsRows] = await Promise.all([
        ctx.db.newsItem.findMany({
          where: {
            entities: { some: { entityId: { in: sectorIds } } },
            // 时间窗（见 surfacingSince）：板块动态也是重要性优先，回填后必须挡住陈年旧闻。
            publishedAt: { gte: surfacingSince(new Date()) },
          },
          orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
          take: 5,
          select: newsSelect,
        }),
        peerIds.length > 0
          ? ctx.db.newsEntity.findMany({
              where: {
                entityId: { in: peerIds },
                news: {
                  OR: [
                    { tier: "PRIMARY" },
                    { importance: { gte: IMPORTANT_THRESHOLD } },
                  ],
                },
              },
              orderBy: { news: { publishedAt: "desc" } },
              take: 8,
              select: {
                entity: { select: { id: true, name: true } },
                news: { select: newsSelect },
              },
            })
          : Promise.resolve([]),
      ]);

      const peerNews = peerNewsRows.map((r) => ({
        entityId: r.entity.id,
        entityName: r.entity.name,
        ...r.news,
      }));

      return { sectors, peers, sectorNews, peerNews };
    }),

  listByType: publicProcedure
    .input(z.object({ type: z.enum(["SECTOR", "COMPANY", "STOCK", "PERSON"]) }))
    .query(({ ctx, input }) =>
      ctx.db.entity.findMany({
        where: { type: input.type },
        orderBy: { name: "asc" },
      }),
    ),

  /**
   * 按分类分页浏览（2026-07-23）：发现页原来每类只列前 90 个、其余「靠搜索找」——
   * 覆盖 802 家公司时等于**没有入口能看到全部**。这里给一个真正能翻到底的列表。
   */
  listByTypePage: publicProcedure
    .input(
      z.object({
        type: z.enum(["SECTOR", "COMPANY", "STOCK", "PERSON"]),
        page: z.number().min(1).max(500).default(1),
        perPage: z.number().min(20).max(200).default(120),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = { type: input.type };
      const [total, items] = await Promise.all([
        ctx.db.entity.count({ where }),
        ctx.db.entity.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (input.page - 1) * input.perPage,
          take: input.perPage,
          select: { id: true, name: true, ticker: true },
        }),
      ]);
      return {
        items,
        total,
        page: input.page,
        pages: Math.max(1, Math.ceil(total / input.perPage)),
      };
    }),

  /**
   * 机会雷达（P5-4）：近 3 天资讯热度最高的公司/股票，标注「有原始进展 / 多为跟进报道 / 关注升温」。
   * 纯规则、零 AI——把「高关注但低新信息」和「有真实新事实」区分开。价格类机会（买点/估值）需 P4-10 数值行情，暂缺不假装。
   */
  radar: publicProcedure.query(async ({ ctx }) => {
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const totals = await ctx.db.newsEntity.groupBy({
      by: ["entityId"],
      where: { news: { publishedAt: { gte: since } } },
      _count: { entityId: true },
      orderBy: { _count: { entityId: "desc" } },
      take: 40,
    });
    const ids = totals.map((t) => t.entityId);
    if (ids.length === 0) return [];

    const [primaries, entities] = await Promise.all([
      ctx.db.newsEntity.groupBy({
        by: ["entityId"],
        where: {
          entityId: { in: ids },
          news: { publishedAt: { gte: since }, tier: "PRIMARY" },
        },
        _count: { entityId: true },
      }),
      ctx.db.entity.findMany({
        where: { id: { in: ids }, type: { in: ["COMPANY", "STOCK"] } },
        select: { id: true, name: true, ticker: true, type: true },
      }),
    ]);

    const primaryMap = new Map(
      primaries.map((p) => [p.entityId, p._count.entityId]),
    );
    const entMap = new Map(entities.map((e) => [e.id, e]));
    const rows: AttentionRow[] = totals
      .filter((t) => entMap.has(t.entityId))
      .map((t) => {
        const e = entMap.get(t.entityId)!;
        return {
          entityId: t.entityId,
          name: e.name,
          ticker: e.ticker,
          type: e.type,
          total: t._count.entityId,
          primary: primaryMap.get(t.entityId) ?? 0,
        };
      });

    return rankAttentionRadar(rows, 8);
  }),

  /**
   * 重点覆盖（2026-07-13 张楚寒/GPT 反馈）：不铺全市场，先聚焦最热门板块最火的股票。
   * 返回 curated 热门板块（hot-universe.ts）及每板块内近 7 天资讯最热的成分股。纯规则、零 AI。
   */
  hotSectors: publicProcedure.query(async ({ ctx }) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const secs = await ctx.db.entity.findMany({
      where: { type: "SECTOR", name: { in: HOT_SECTOR_NAMES } },
      select: { id: true, name: true },
    });
    if (secs.length === 0) return { sectors: [], totalStocks: 0 };

    const rels = await ctx.db.entityRelation.findMany({
      where: {
        toId: { in: secs.map((s) => s.id) },
        type: "BELONGS_TO",
        from: { type: "COMPANY" },
      },
      select: { toId: true, from: { select: { id: true, name: true } } },
    });
    const memberIds = [...new Set(rels.map((r) => r.from.id))];
    const heat = memberIds.length
      ? await ctx.db.newsEntity.groupBy({
          by: ["entityId"],
          where: {
            entityId: { in: memberIds },
            news: { publishedAt: { gte: since } },
          },
          _count: { entityId: true },
        })
      : [];
    const heatMap = new Map(heat.map((h) => [h.entityId, h._count.entityId]));

    const bySector = new Map<
      string,
      { id: string; name: string; heat: number }[]
    >();
    for (const r of rels) {
      const arr = bySector.get(r.toId) ?? [];
      arr.push({
        id: r.from.id,
        name: r.from.name,
        heat: heatMap.get(r.from.id) ?? 0,
      });
      bySector.set(r.toId, arr);
    }

    const sectors = secs
      .map((s) => {
        const members = (bySector.get(s.id) ?? []).sort(
          (a, b) => b.heat - a.heat,
        );
        return {
          sectorId: s.id,
          name: s.name,
          memberCount: members.length,
          heat7d: members.reduce((n, m) => n + m.heat, 0),
          top: members.slice(0, 5),
        };
      })
      .filter((s) => s.memberCount > 0)
      .sort((a, b) => hotSectorOrder(a.name) - hotSectorOrder(b.name));

    return { sectors, totalStocks: memberIds.length };
  }),

  newsById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.newsItem.findMany({
        where: { entities: { some: { entityId: input.id } } },
        orderBy: [{ publishedAt: "desc" }, { importance: "desc" }],
        // 多取些：一次定增/重组的同日公告轰炸会吃掉几十条，折叠(collapseAnnouncementBursts)后才好露出其它动态。
        // 一年回填后每家有上百条，60 条只够看两个月——提到 120，「资讯/公告」两个 tab 都更厚。
        // 更早的脉络由「大事记」tab 负责（只收重磅、按月折叠），两者分工：近况 vs 一年。
        take: 120,
        select: {
          id: true,
          title: true,
          url: true,
          summary: true,
          brief: true,
          tier: true,
          importance: true,
          publishedAt: true,
          source: { select: { name: true } },
          event: { select: { count: true } },
        },
      }),
    ),

  /**
   * 个股页「资讯 / 公告」分页（2026-07-23）。
   *
   * 回填一年后单只股可有上百条（广发证券 352 条），原来 newsById 一次取 120 条封顶，
   * 后面的**根本没有入口能看到**。这里改成服务端分页，并顺带修掉一个老毛病：
   * 「公告」tab 原本是在那 120 条里筛 PRIMARY，媒体多的公司会显得没几条公告——
   * 现在按 tier 直接查库，公告页看到的就是这家公司真正的全部公告。
   */
  newsPage: publicProcedure
    .input(
      z.object({
        id: z.string(),
        tab: z.enum(["news", "announce"]).default("news"),
        page: z.number().min(1).max(500).default(1),
        perPage: z.number().min(10).max(100).default(40),
      }),
    )
    .query(async ({ ctx, input }) => {
      const base = { entities: { some: { entityId: input.id } } };
      const where =
        input.tab === "announce" ? { ...base, tier: "PRIMARY" as const } : base;
      const [total, announceTotal, items] = await Promise.all([
        ctx.db.newsItem.count({ where: base }),
        ctx.db.newsItem.count({ where: { ...base, tier: "PRIMARY" } }),
        ctx.db.newsItem.findMany({
          where,
          orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
          skip: (input.page - 1) * input.perPage,
          take: input.perPage,
          select: {
            id: true,
            title: true,
            url: true,
            summary: true,
            brief: true,
            tier: true,
            importance: true,
            publishedAt: true,
            source: { select: { name: true } },
            event: { select: { count: true } },
          },
        }),
      ]);
      const shown = input.tab === "announce" ? announceTotal : total;
      return {
        items,
        newsTotal: total,
        announceTotal,
        page: input.page,
        pages: Math.max(1, Math.ceil(shown / input.perPage)),
      };
    }),

  /**
   * 一年大事记（2026-07-23 一年回填）：只取**重磅**事件，跨度一年，供个股页按月分组展示。
   * 「资讯」流按时间倒序取 60 条，回填后只够看最近几个月；大事记补的是「一年脉络」这一视角。
   * 门槛沿用重磅线（importance ≥ IMPORTANT_THRESHOLD）——例行治理公告进不来，不糊墙。
   */
  milestones: publicProcedure
    .input(
      z.object({ id: z.string(), months: z.number().min(1).max(24).default(12) }),
    )
    .query(({ ctx, input }) => {
      const since = new Date();
      since.setMonth(since.getMonth() - input.months);
      return ctx.db.newsItem.findMany({
        where: {
          entities: { some: { entityId: input.id } },
          importance: { gte: IMPORTANT_THRESHOLD },
          publishedAt: { gte: since },
        },
        orderBy: [{ publishedAt: "desc" }],
        take: 200,
        select: {
          id: true,
          title: true,
          url: true,
          summary: true,
          brief: true,
          tier: true,
          importance: true,
          publishedAt: true,
          source: { select: { name: true } },
          event: { select: { count: true } },
        },
      });
    }),

  search: publicProcedure
    .input(z.object({ q: z.string() }))
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      if (q.length === 0) return [];
      const raw = await ctx.db.entity.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { shortName: { contains: q, mode: "insensitive" } },
            { ticker: { contains: q } },
            { aliases: { has: q } },
          ],
        },
        take: 40,
        orderBy: { type: "asc" },
        select: { id: true, name: true, type: true, ticker: true },
      });
      // 合并 COMPANY 与其发行 STOCK（同一家公司别显示两条、别双代码）：按 ISSUES 关系归并到规范 COMPANY 页。
      const companyIds = raw
        .filter((e) => e.type === "COMPANY")
        .map((e) => e.id);
      const stockIds = raw.filter((e) => e.type === "STOCK").map((e) => e.id);
      const rels =
        companyIds.length > 0 || stockIds.length > 0
          ? await ctx.db.entityRelation.findMany({
              where: {
                type: "ISSUES",
                OR: [
                  { fromId: { in: companyIds } },
                  { toId: { in: stockIds } },
                ],
              },
              select: {
                from: {
                  select: { id: true, name: true, type: true, ticker: true },
                },
                to: { select: { id: true, ticker: true } },
              },
            })
          : [];
      const links = rels.map((r) => ({
        companyId: r.from.id,
        company: r.from,
        stockId: r.to.id,
        stockTicker: r.to.ticker,
      }));
      return dedupeSearchResults(raw, links).slice(0, 20);
    }),

  /**
   * 自助加股（backlog #4）：用户搜到未覆盖的真 A 股时，自建实体并加入自选。
   * 全程用户发起、只落该股客观信息（名称/代码/行情），不含任何推荐——合规安全（铁律②）。
   * 流程：分类 → (名称则东财解析代码) → 拉行情校验真实存在并取规范名 → 剔 ST/退市/指数基金
   *      → 幂等建 COMPANY+STOCK+ISSUES（打 meta 来源=user-add）→ 加入自选。
   * 建成后该实体自动进 ingest 词典，下轮抓取起绑定其资讯/公告；行情即时可见。
   */
  addStock: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      const classified = classifyStockQuery(input.query);
      if (classified.kind === "invalid") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "没能识别这个标的，试试 6 位股票代码（如 600519）。",
        });
      }
      const code =
        classified.kind === "code"
          ? classified.code
          : await resolveCodeByName(classified.name);
      if (!code) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "没找到这个名称对应的 A 股，换股票代码试试。",
        });
      }
      const quote = await fetchQuote(code);
      if (!quote) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `拉不到 ${code} 的行情，确认是有效的 A 股代码。`,
        });
      }
      const name = normalizeStockName(quote.name);
      if (!name || !isSeedableStock(name)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "解牛暂不收录风险警示(ST)、退市或指数/基金类标的。",
        });
      }
      const { companyId } = await ensureStockEntities(ctx.db, name, code, {
        source: "user-add",
        addedBy: ctx.session.user.id,
      });
      await ctx.db.watchlist.upsert({
        where: {
          userId_entityId: {
            userId: ctx.session.user.id,
            entityId: companyId,
          },
        },
        create: { userId: ctx.session.user.id, entityId: companyId },
        update: {},
      });
      return { companyId, name, ticker: code };
    }),

  followerCount: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.watchlist.count({ where: { entityId: input.id } }),
    ),

  /** 资讯记分卡：近 30 日资讯覆盖的客观统计（热度分位 / 重磅密度 / 多视角相关）。非评级、不预测。 */
  scorecard: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [news30d, hot30d, peerGroups, recent] = await Promise.all([
        ctx.db.newsEntity.count({
          where: { entityId: input.id, news: { publishedAt: { gte: since } } },
        }),
        ctx.db.newsEntity.count({
          where: {
            entityId: input.id,
            news: {
              publishedAt: { gte: since },
              importance: { gte: IMPORTANT_THRESHOLD },
            },
          },
        }),
        ctx.db.newsEntity.groupBy({
          by: ["entityId"],
          where: { news: { publishedAt: { gte: since } } },
          _count: { entityId: true },
        }),
        ctx.db.newsItem.findMany({
          where: { entities: { some: { entityId: input.id } } },
          orderBy: { publishedAt: "desc" },
          take: 20,
          select: { title: true, summary: true },
        }),
      ]);

      const peerNews30d = peerGroups.map((g) => g._count.entityId);

      const tally: Partial<Record<string, number>> = {};
      for (const n of recent) {
        for (const k of strongMasters(n)) tally[k] = (tally[k] ?? 0) + 1;
      }
      const need = Math.max(1, Math.ceil(recent.length * 0.3));
      const focusMasters = Object.values(tally).filter(
        (c) => (c ?? 0) >= need,
      ).length;

      return buildScorecard({ news30d, hot30d, peerNews30d, focusMasters });
    }),
});
