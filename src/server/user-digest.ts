// 每日个人复盘的取数与生成。相对导入、tsx 安全。
//
// 分工：`market-digest` 一天一次算市场背景（共享，1 次 AI 调用）；这里每个有自选的用户一次小调用，
// 只写贴着他组合的文字。所有数值在这里算好，模型不碰（见 lib/user-digest 的合并机制）。

import type { PrismaClient } from "../../generated/prisma";
import {
  summarizePortfolio,
  summarizeExposure,
  buildUserDigestPrompt,
  parseUserDigestResponse,
  userDigestInputHash,
  USER_DIGEST_SYSTEM,
  type PositionIn,
  type FlowIn,
  type SectorIn,
  type TouchedFacts,
  type UserDigestFacts,
  type UserDigestData,
} from "../lib/user-digest";
import { tradeDateOf, isDigestWorthyFiling } from "../lib/market-digest";
import { isMarketLevelWorthy } from "../lib/digest-substance";
import { isOwnFact } from "../lib/news-subject";
import { groundNotes } from "./note-check";
import { aggregateSectors, rankSectors, type StockFlow } from "../lib/rotation";
import { upcomingDisclosureNodes } from "../lib/earnings-calendar";
import { llmChat, llmModel } from "./llm";

const NEWS_WINDOW_HOURS = 24;
const NEWS_TAKE = 6;
/** 每只标的最多带几条自有事实进提示词——归因的唯一合法依据。 */
const FACTS_PER_POSITION = 2;
const TOUCHED_WINDOW_DAYS = 7;

type UserDigestDb = Pick<
  PrismaClient,
  | "user"
  | "watchlist"
  | "newsItem"
  | "userDigest"
  | "marketDigest"
  | "thesisDimensionState"
  | "investorProfile"
  | "$queryRawUnsafe"
>;

/** 全市场资金流 + 板块归属——一次取好，所有用户共用（别每个用户查一遍）。 */
async function loadMarketContext(db: UserDigestDb) {
  const [flowRows, memberRows] = await Promise.all([
    db.$queryRawUnsafe<{ ticker: string; name: string; detail: unknown }[]>(`
      SELECT e.ticker, e.name, s.detail
      FROM "EntitySignal" s
      JOIN "Entity" e ON e.id = s."entityId"
      WHERE s.kind = 'flow' AND e.ticker IS NOT NULL
    `),
    db.$queryRawUnsafe<{ ticker: string; sector: string }[]>(`
      SELECT st.ticker, sec.name AS sector
      FROM "EntityRelation" r
      JOIN "Entity" st  ON st.id  = r."fromId" AND st.type  = 'STOCK'
      JOIN "Entity" sec ON sec.id = r."toId"   AND sec.type = 'SECTOR'
      WHERE r.type = 'BELONGS_TO' AND st.ticker IS NOT NULL
    `),
  ]);

  const flows: StockFlow[] = [];
  for (const r of flowRows) {
    const d = r.detail as Record<string, unknown> | null;
    if (!d || typeof d !== "object") continue;
    const changePct = typeof d.changePct === "number" ? d.changePct : null;
    const netInflow = typeof d.netInflow === "number" ? d.netInflow : null;
    const price = typeof d.price === "number" ? d.price : null;
    if (changePct === null || netInflow === null || price === null) continue;
    flows.push({
      code: r.ticker,
      name: r.name,
      price,
      changePct,
      netInflow,
      inflowRatio: typeof d.inflowRatio === "number" ? d.inflowRatio : 0,
    });
  }
  const membership = new Map<string, string>();
  for (const m of memberRows) if (!membership.has(m.ticker)) membership.set(m.ticker, m.sector);
  const ranked = rankSectors(aggregateSectors(flows, membership), 40);
  const sectors: SectorIn[] = ranked.map((s) => ({
    name: s.sector,
    avgChangePct: s.avgChangePct,
    signal: s.signal,
  }));
  return { flows, membership, sectors };
}

/**
 * 一个用户的持仓：`Watchlist` 里 COMPANY 型实体没有 ticker，得顺着 ISSUES 关系找到它发行的股票，
 * 否则行情、板块归属全对不上（实测 14 条自选里 9 条是 COMPANY）。
 */
async function loadPositions(
  db: UserDigestDb,
  userId: string,
  membership: Map<string, string>,
): Promise<{ positions: PositionIn[]; aliasByPosition: Map<string, string[]> }> {
  const rows = await db.$queryRawUnsafe<
    {
      entityId: string;
      name: string;
      ticker: string | null;
      stockId: string | null;
      stockTicker: string | null;
      companyId: string | null;
      status: string;
      weight: number | null;
      note: string | null;
    }[]
  >(
    `
    SELECT e.id AS "entityId", e.name, e.ticker,
           st.id AS "stockId", st.ticker AS "stockTicker",
           co.id AS "companyId",
           w.status, w.weight, w.note
    FROM "Watchlist" w
    JOIN "Entity" e ON e.id = w."entityId"
    LEFT JOIN "EntityRelation" r ON r."fromId" = e.id AND r.type = 'ISSUES'
    LEFT JOIN "Entity" st ON st.id = r."toId" AND st.type = 'STOCK'
    LEFT JOIN "EntityRelation" r2 ON r2."toId" = e.id AND r2.type = 'ISSUES'
    LEFT JOIN "Entity" co ON co.id = r2."fromId" AND co.type = 'COMPANY'
    WHERE w."userId" = $1
  `,
    userId,
  );

  const byEntity = new Map<string, PositionIn>();
  // 同一家公司的两个实体（COMPANY 与它发行的 STOCK）——资讯可能绑在任一侧，取数时两边都要查
  const aliasByPosition = new Map<string, Set<string>>();
  for (const r of rows) {
    const aliases = aliasByPosition.get(r.entityId) ?? new Set([r.entityId]);
    if (r.stockId) aliases.add(r.stockId);
    if (r.companyId) aliases.add(r.companyId);
    aliasByPosition.set(r.entityId, aliases);

    const ticker = r.ticker ?? r.stockTicker ?? null;
    const prev = byEntity.get(r.entityId);
    // 同一实体可能因 ISSUES join 出多行，取第一个能拿到 ticker 的
    if (prev && !(!prev.ticker && ticker)) continue;
    byEntity.set(r.entityId, {
      entityId: r.entityId,
      name: r.name.replace(/\(\d{4,6}\)\s*$/, "").trim(),
      ticker,
      held: r.status === "HOLDING",
      weight: r.weight,
      note: r.note,
      sector: ticker ? (membership.get(ticker) ?? null) : null,
    });
  }
  return {
    positions: [...byEntity.values()],
    aliasByPosition: new Map([...aliasByPosition].map(([k, v]) => [k, [...v]])),
  };
}

async function loadTouched(
  db: UserDigestDb,
  entityIds: string[],
  nameById: Map<string, string>,
): Promise<TouchedFacts[]> {
  if (entityIds.length === 0) return [];
  const since = new Date(Date.now() - TOUCHED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.thesisDimensionState.findMany({
    where: { entityId: { in: entityIds }, lastCrossAt: { gte: since } },
    orderBy: { lastCrossAt: "desc" },
    take: 5,
    select: {
      entityId: true,
      dimensionKey: true,
      lastCrossFrom: true,
      lastCrossTo: true,
      lastCrossNote: true,
    },
  });
  return rows.map((r) => ({
    entityName: nameById.get(r.entityId) ?? "",
    dimensionKey: r.dimensionKey,
    fromState: r.lastCrossFrom ?? "neutral",
    toState: r.lastCrossTo ?? "neutral",
    note: r.lastCrossNote ?? "",
  }));
}

/**
 * 用户标的的当日资讯。返回两份：一份平铺给提示词的「资讯」段，一份**按 entityId 归档**——
 * 后者才是关键：原先只有平铺列表、没有 mover↔事实的配对，模型写每只股的归因时手上没有它自己的
 * 事实，只能退回「受板块拖累」。门槛比早报低（≥45）：这是**你自己的**股，一条相关消息都很珍贵。
 */
async function loadNews(
  db: UserDigestDb,
  /** 自选实体 id → 它「同一家公司」的所有实体 id（COMPANY + 它发行的 STOCK）。 */
  aliasByPosition: Map<string, string[]>,
  nameById: Map<string, string>,
) {
  const empty = { flat: [], byEntity: new Map<string, string[]>() };
  if (aliasByPosition.size === 0) return empty;
  // 自选里 COMPANY 型实体没有 ticker，而当日资讯**大多绑在 STOCK 实体**上——只按自选 id 查，
  // 一半持仓永远取不到自己的消息（实测：市场复盘给兆易创新找到了「机构警告存储行情拐点」，
  // 个人复盘同一只却是空的）。这里按「公司的全部实体 id」查，再映射回自选 id。
  const lookup = new Map<string, string>();
  for (const [posId, aliases] of aliasByPosition) {
    for (const a of aliases) lookup.set(a, posId);
  }
  const allIds = [...lookup.keys()];
  const since = new Date(Date.now() - NEWS_WINDOW_HOURS * 60 * 60 * 1000);
  const rows = await db.newsItem.findMany({
    where: {
      // **不设重要性门槛**（市场复盘的 gatherStockFacts 也没有）。门槛是给「全市场选头条」用的；
      // 这是**你自己持仓**的消息，一条 30 分的「二连跌停，机构警告存储行情拐点」正是你要的。
      // 实测：门槛 45 时该用户 7 只持仓有 5 只取不到任何事实、归因全空。
      publishedAt: { gte: since },
      entities: { some: { entityId: { in: allIds } } },
    },
    orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
    take: 120,
    select: {
      title: true,
      brief: true,
      summary: true,
      // 主体判定要用：源体裁（公告/结构化事件的主体由源权威给出）
      source: { select: { kind: true } },
      // 这里**不能**按 allIds 过滤：扇出闸要数这条资讯一共绑了几家公司，
      // 只看自选那几个实体会把「顺带提到别家」看成「只绑了它」。
      entities: {
        select: {
          entityId: true,
          entity: {
            select: {
              type: true,
              name: true,
              shortName: true,
              aliases: true,
              ticker: true,
            },
          },
        },
      },
    },
  });

  const byEntity = new Map<string, string[]>();
  const worthy = rows.filter(
    (r) => isDigestWorthyFiling(r.title) && isMarketLevelWorthy(r.title),
  );
  // 「绑定到它」≠「关于它」。绑定是**召回导向**的（个股资讯源按名字全文搜索、摘要里的顺带提及
  // 也算），拿它当「自有事实」会把「没有事实就留空」那道护栏顶开，模型随即编出因果——
  // 潞 2026-08-03 报的国盾量子那条就是这么来的（依据两条全是频准激光 IPO 的报道，
  // 它只是被列举的客户）。这里换上精度导向的判据，见 lib/news-subject。
  const own: { title: string; brief: string; posIds: string[] }[] = [];
  for (const r of worthy) {
    const boundEntityCount = r.entities.filter(
      (e) => e.entity.type === "COMPANY" || e.entity.type === "STOCK",
    ).length;
    // 一条资讯常同时绑 COMPANY + STOCK 两个实体，归一到自选那一条上再判主体
    const byPos = new Map<string, (typeof r.entities)[number]["entity"][]>();
    for (const link of r.entities) {
      const posId = lookup.get(link.entityId);
      if (!posId) continue;
      const arr = byPos.get(posId) ?? [];
      arr.push(link.entity);
      byPos.set(posId, arr);
    }
    const posIds = [...byPos]
      .filter(([, ents]) =>
        isOwnFact({ title: r.title, sourceKind: r.source.kind, boundEntityCount }, ents),
      )
      .map(([posId]) => posId);
    if (posIds.length === 0) continue;
    own.push({
      title: r.title,
      brief: (r.brief ?? r.summary ?? "").slice(0, 60),
      posIds,
    });
  }
  for (const r of own) {
    for (const posId of r.posIds) {
      const arr = byEntity.get(posId) ?? [];
      if (arr.length >= FACTS_PER_POSITION || arr.includes(r.title)) continue;
      arr.push(r.title);
      byEntity.set(posId, arr);
    }
  }
  const flat = own.slice(0, NEWS_TAKE).map((r) => ({
    entityName: nameById.get(r.posIds[0] ?? "") ?? "",
    title: r.title,
    brief: r.brief,
  }));
  return { flat, byEntity };
}

export type UserDigestResult = {
  userId: string;
  status: "created" | "unchanged" | "rejected" | "no-positions";
  reason?: string;
  data?: UserDigestData;
};

export type UserDigestStats = {
  users: number;
  created: number;
  unchanged: number;
  rejected: number;
  skipped: number;
};

/**
 * 为所有有自选的用户生成个人复盘。
 * - 同日事实指纹未变 → 跳过（省 token）
 * - 模型输出过不了合规校验 → **不入库**，如实计入 rejected
 */
export async function generateUserDigests(
  db: UserDigestDb,
  opts: { now?: Date; force?: boolean; userIds?: string[] } = {},
): Promise<{ stats: UserDigestStats; results: UserDigestResult[] }> {
  const now = opts.now ?? new Date();
  const tradeDate = tradeDateOf(now);

  const [{ flows, membership, sectors }, market] = await Promise.all([
    loadMarketContext(db),
    db.marketDigest.findUnique({
      // 邮件/个人复盘引用的是**收盘复盘**那一份（盘前简报是另一个场次）。
      where: { tradeDate_market_session: { tradeDate, market: "CN", session: "close" } },
      select: { overview: true },
    }),
  ]);
  const flowIn: FlowIn[] = flows.map((f) => ({
    code: f.code,
    name: f.name,
    changePct: f.changePct,
    netInflow: f.netInflow,
  }));
  const catalysts = upcomingDisclosureNodes(now, 2).map(
    (n) => `${n.label}法定披露截止还有 ${n.daysUntil} 天`,
  );

  const users = await db.user.findMany({
    where: {
      ...(opts.userIds ? { id: { in: opts.userIds } } : {}),
      watchlist: { some: {} },
    },
    select: { id: true },
  });

  const stats: UserDigestStats = {
    users: users.length,
    created: 0,
    unchanged: 0,
    rejected: 0,
    skipped: 0,
  };
  const results: UserDigestResult[] = [];

  for (const u of users) {
    const { positions, aliasByPosition } = await loadPositions(db, u.id, membership);
    if (positions.length === 0) {
      stats.skipped++;
      results.push({ userId: u.id, status: "no-positions" });
      continue;
    }
    const nameById = new Map(positions.map((p) => [p.entityId, p.name]));
    const entityIds = positions.map((p) => p.entityId);

    const [touched, news, profile] = await Promise.all([
      loadTouched(db, entityIds, nameById),
      loadNews(db, aliasByPosition, nameById),
      db.investorProfile.findUnique({
        where: { userId: u.id },
        select: { style: true, holdPeriod: true },
      }),
    ]);

    // 把每只标的自己的当日事实挂回持仓上——mover↔事实配对是「不写板块废话」的前提
    const withFacts = positions.map((p) => ({
      ...p,
      facts: news.byEntity.get(p.entityId) ?? [],
    }));

    const facts: UserDigestFacts = {
      tradeDate,
      market: "CN",
      profile: { style: profile?.style ?? null, horizon: profile?.holdPeriod ?? null },
      portfolio: summarizePortfolio(withFacts, flowIn),
      exposure: summarizeExposure(withFacts, sectors),
      touched,
      news: news.flat,
      marketOverview: market?.overview ?? "",
      catalysts,
    };

    const hash = userDigestInputHash(facts);
    const existing = await db.userDigest.findUnique({
      where: { userId_tradeDate_market: { userId: u.id, tradeDate, market: "CN" } },
      select: { inputHash: true },
    });
    if (existing?.inputHash === hash && !opts.force) {
      stats.unchanged++;
      results.push({ userId: u.id, status: "unchanged" });
      continue;
    }

    const raw = await llmChat(USER_DIGEST_SYSTEM, buildUserDigestPrompt(facts), {
      maxTokens: 900,
    });
    const data = parseUserDigestResponse(raw, facts);
    // 归因逐条核对：这句话里的说法，在它自己的事实里找不找得到依据。
    // 主体判定管的是「喂进去的料对不对」，这道管的是「写出来的有没有超出料」——
    // 潞报的那条正是两篇文章各取一半缝出来的（「光」＋「量子」→「光量子赛道」），
    // 料没错，是写的时候跨条合成了一件没发生的事。出错一律放行，见 note-check。
    if (data) {
      await groundNotes(
        data.portfolio.movers
          .filter((m) => m.note)
          .map((m) => ({
            item: { subject: m.name, facts: m.facts, note: m.note ?? "" },
            clear: () => {
              m.note = "";
            },
          })),
        `个人复盘 ${u.id.slice(0, 8)}`,
      );
    }
    if (!data) {
      stats.rejected++;
      results.push({
        userId: u.id,
        status: "rejected",
        reason: `未过校验（非 JSON / 缺段 / 含买卖指令 / 判断非双向）：${raw.slice(0, 120)}`,
      });
      continue;
    }

    const payload = {
      headline: data.headline,
      portfolio: data.portfolio,
      exposure: data.exposure,
      touched: data.touched,
      watchpoints: data.watchpoints,
      judgment: data.judgment,
      inputHash: hash,
      model: llmModel(),
    };
    await db.userDigest.upsert({
      where: { userId_tradeDate_market: { userId: u.id, tradeDate, market: "CN" } },
      create: { userId: u.id, tradeDate, market: "CN", ...payload },
      update: payload,
    });
    stats.created++;
    results.push({ userId: u.id, status: "created", data });
  }

  return { stats, results };
}
