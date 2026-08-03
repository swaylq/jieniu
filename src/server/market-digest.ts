// 每日 AI 市场复盘的取数与生成。相对导入、tsx 安全。
//
// 取数全部来自**已入库的客观数据**：指数行情、板块资金聚合、重磅公告、已知披露日程。
// AI 只做归纳与串联，不给它自由发挥的空间——提示词里没有的它不该写（见 DIGEST_SYSTEM 铁律①）。

import type { PrismaClient } from "../../generated/prisma";
import {
  buildDigestPrompt,
  digestInputHash,
  parseDigestResponse,
  tradeDateOf,
  cleanEntityName,
  isDigestWorthyFiling,
  toDigestEvent,
  DIGEST_SYSTEM,
  PREOPEN_SYSTEM,
  type DigestInputs,
  type DigestSession,
  type DigestStockIn,
  type DigestSectorIn,
  type MarketDigestData,
} from "../lib/market-digest";
import { aggregateSectors, rankSectors, type StockFlow } from "../lib/rotation";
import { isInauspicious } from "../lib/digest-filter";
import { summarizeBreadth, isMarketLevelWorthy } from "../lib/digest-substance";
import { isOwnFact } from "../lib/news-subject";
import { groundNotes } from "./note-check";
import {
  categorize,
  mergeEvents,
  scoreEvent,
  selectEvents,
  coverageReport,
  type CoverageRow,
  type RankContext,
  type RawEvent,
  type ScoredEvent,
} from "../lib/digest-pipeline";
import { upcomingDisclosureNodes } from "../lib/earnings-calendar";
import { fetchIndexQuotes } from "./quote";
import { llmChat, llmModel } from "./llm";

const NEWS_WINDOW_HOURS = 24;
const SECTOR_TAKE = 4;
const STOCK_TAKE = 8;

// ---------------------------------------------------------------------------
// 六步事件管线的参数（张楚寒 2026-07-30）
// ---------------------------------------------------------------------------
/** 候选池时间窗。30 小时而不是 24：A 股开盘前的隔夜海外消息是当天最重要的外生变量。 */
const POOL_WINDOW_HOURS = 30;
/**
 * 候选池的 importance 下限，**刻意压得很低**。门槛的活是挡噪音，而噪音该由排序判成低分。
 * 上一轮把国内宏观整层误杀 41/44 条，就是因为用了一个按产业事件标定的绝对门槛去卡政策类——
 * **绝对门槛跨层不可比**。
 */
const POOL_MIN_IMPORTANCE = 25;
/** 扫描上限：全市场一天资讯 2500+ 条，取少了会在高分档就截断，宏观/资金层永远扫不到。 */
const POOL_SCAN_TAKE = 3000;
/** 张楚寒：「从中选出 15—25 个真正重要的事件」。 */
const EVENTS_MIN = 15;
const EVENTS_MAX = 25;
/**
 * 每类保底/上限：保底防止弱势类被挤空，上限防止公司类吃干名额。
 * 保底定 3 而不是 2：实测保底 2 时国内宏观从 128 条池子里只出 2 条，
 * 而「国内有啥大事」正是 sway 连着两轮反馈说不足的那一层——全局分数竞争里它天然弱势
 * （政策类拿不到产业事件那种「动作＋金额」的高分），只能靠配额保。
 */
const EVENTS_PER_CATEGORY_FLOOR = 3;
const EVENTS_PER_CATEGORY_CAP = 8;
/**
 * 同一主体在同一类里最多几条。实测第一版公司类 8 个位置有 6 个是同一件事
 * （「兆易创新朱一明套现44亿后增持回购」的六种写法）——连续追更的措辞和数字都不一样，
 * 标题相似度收不住，只有主体是同一个。
 */
const EVENTS_PER_SUBJECT_CAP = 2;

/** 每只重点股最多带几条自有事实进提示词。 */
const STOCK_FACTS = 2;

type DigestDb = Pick<
  PrismaClient,
  "newsItem" | "marketDigest" | "$queryRawUnsafe" | "watchlist"
>;

/** 板块强弱：复用轮动看板的资金聚合（EntitySignal kind='flow' + BELONGS_TO 板块归属）。 */
async function gatherSectors(db: DigestDb) {
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

  // `parseFlowRows` 吃的是东财 clist 原始响应；这里读的是已入库的 EntitySignal.detail，
  // 形状不同，按轮动看板同样的方式手工取字段（缺任一关键值就丢弃，不当 0）。
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
  // 一只股可能挂多个板块，取第一个（与轮动看板一致）。
  const membership = new Map<string, string>();
  for (const m of memberRows) if (!membership.has(m.ticker)) membership.set(m.ticker, m.sector);
  const ranked = rankSectors(aggregateSectors(flows, membership), 20);

  const toIn = (s: (typeof ranked)[number]) => ({
    name: s.sector,
    avgChangePct: s.avgChangePct,
    signal: s.signal,
    leaders: s.leaders.map((l) => l.name),
    facts: [] as string[], // 稍后按代表股回填（gatherDigestInputs）
  });
  const up = ranked.filter((s) => s.avgChangePct > 0).slice(0, SECTOR_TAKE);
  const down = [...ranked]
    .filter((s) => s.avgChangePct < 0)
    .sort((a, b) => a.avgChangePct - b.avgChangePct)
    .slice(0, SECTOR_TAKE);
  return { strong: up.map(toIn), weak: down.map(toIn), flows };
}

/**
 * 每只重点股**自己**当天的事实。这是 2026-07-29 那轮反馈的直接根因：这里原先写死 `headline: ""`，
 * 模型手上一条个股事实都没有，于是 8 只股全写「受半导体板块拖累」——一年 365 天都能这么写。
 * 按 ticker 与公司名双路匹配（自选/覆盖池里 COMPANY 型实体没有 ticker）。
 */
async function gatherStockFacts(
  db: DigestDb,
  stocks: { name: string; ticker: string }[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (stocks.length === 0) return out;
  const since = new Date(Date.now() - NEWS_WINDOW_HOURS * 60 * 60 * 1000);
  const tickers = stocks.map((s) => s.ticker);
  const names = stocks.map((s) => cleanEntityName(s.name));

  const rows = await db.$queryRawUnsafe<
    {
      ticker: string | null;
      name: string;
      shortName: string | null;
      aliases: string[];
      title: string;
      importance: number;
      kind: string;
      boundEntityCount: number;
    }[]
  >(
    `
    SELECT e.ticker, e.name, e."shortName", e.aliases, n.title, n.importance, s.kind,
           (SELECT COUNT(*)::int FROM "NewsEntity" ne2
              JOIN "Entity" e2 ON e2.id = ne2."entityId"
             WHERE ne2."newsId" = n.id AND e2.type IN ('STOCK','COMPANY')) AS "boundEntityCount"
    FROM "NewsItem" n
    JOIN "NewsEntity" ne ON ne."newsId" = n.id
    JOIN "Entity" e ON e.id = ne."entityId"
    JOIN "Source" s ON s.id = n."sourceId"
    WHERE n."publishedAt" >= $1
      AND e.type IN ('STOCK','COMPANY')
      AND (e.ticker = ANY($2::text[]) OR e.name = ANY($3::text[]))
    ORDER BY n.importance DESC, n."publishedAt" DESC
  `,
    since,
    tickers,
    names,
  );

  for (const r of rows) {
    // 除了事务性公告，还要挡「7月29日早间新闻精选」这类导航体裁——它绑到个股上，
    // 但对「这只股今天为什么这样走」一个字的信息都没有
    if (!isDigestWorthyFiling(r.title) || !isMarketLevelWorthy(r.title)) continue;
    // 再挡一层「绑到它但不是关于它」：这只股只是文章里被顺带提到的一家（见 lib/news-subject）。
    // 归因用的事实必须是它自己的，否则模型会拿别家公司的事编出一条因果。
    if (
      !isOwnFact(
        { title: r.title, sourceKind: r.kind, boundEntityCount: r.boundEntityCount },
        [{ name: r.name, shortName: r.shortName, aliases: r.aliases, ticker: r.ticker }],
      )
    )
      continue;
    // 一条资讯常同时绑 COMPANY + STOCK 两个实体，归一到「股票代码或干净公司名」这一个键
    const key = r.ticker ?? cleanEntityName(r.name);
    const arr = out.get(key) ?? [];
    if (arr.length >= STOCK_FACTS) continue;
    if (arr.some((t) => t === r.title)) continue;
    arr.push(r.title);
    out.set(key, arr);
  }
  return out;
}

/** 重点个股：优先有人自选的，其次当日振幅最大的——两者都取自同一份资金流数据。 */
async function gatherStocks(db: DigestDb, flows: StockFlow[]): Promise<DigestStockIn[]> {
  // 自选里 COMPANY 型实体没有 ticker（实测 14 条里 9 条是 COMPANY），只按 ticker 匹配会漏掉大半——
  // 所以名字也纳入匹配，并剥掉资金流数据里的代码后缀再比。
  const watched = await db.$queryRawUnsafe<{ ticker: string | null; name: string }[]>(`
    SELECT DISTINCT e.ticker, e.name FROM "Watchlist" w
    JOIN "Entity" e ON e.id = w."entityId"
  `);
  const watchedSet = new Set<string>();
  for (const w of watched) {
    if (w.ticker) watchedSet.add(w.ticker);
    if (w.name) watchedSet.add(cleanEntityName(w.name));
  }
  const scored = flows
    .map((f) => ({
      f,
      w: watchedSet.has(f.code) || watchedSet.has(cleanEntityName(f.name)) ? 1 : 0,
    }))
    .sort(
      (a, b) => b.w - a.w || Math.abs(b.f.changePct) - Math.abs(a.f.changePct),
    )
    // 先取双倍候选，查完事实再挑：「重点个股」里 6/8 只没有任何可讲的事实，
    // 这一段就退化成一张价格表。同等条件下**有话可说的优先**。
    .slice(0, STOCK_TAKE * 2);
  const facts = await gatherStockFacts(
    db,
    scored.map(({ f }) => ({ name: f.name, ticker: f.code })),
  );
  const factsOf = (f: StockFlow) =>
    facts.get(f.code) ?? facts.get(cleanEntityName(f.name)) ?? [];
  return scored
    .map(({ f, w }) => ({ f, w, facts: factsOf(f) }))
    .sort(
      (a, b) =>
        b.w - a.w ||
        Number(b.facts.length > 0) - Number(a.facts.length > 0) ||
        Math.abs(b.f.changePct) - Math.abs(a.f.changePct),
    )
    .slice(0, STOCK_TAKE)
    .map(({ f, facts: fx }) => ({
      name: f.name,
      ticker: f.code,
      price: f.price,
      changePct: f.changePct,
      facts: fx,
    }));
}

/**
 * 板块的「自有事实」= 它代表股当日的消息面。板块本身不会发公告，但「游戏板块为什么涨」
 * 的答案通常就在龙头股的当日消息里（「巨人网络触及涨停」「东鹏饮料业绩预增」）。
 * 没有它，板块 note 只能退回「板块走强，资金流入」这种同义反复。
 */
async function attachSectorFacts(db: DigestDb, sectors: DigestSectorIn[]) {
  const leaders = sectors.flatMap((s) =>
    s.leaders.map((n: string) => ({ name: n, ticker: "" })),
  );
  if (leaders.length === 0) return;
  const facts = await gatherStockFacts(db, leaders);
  for (const s of sectors) {
    const out: string[] = [];
    for (const l of s.leaders) {
      for (const t of facts.get(cleanEntityName(l)) ?? []) {
        if (out.length < 3 && !out.includes(t)) out.push(t);
      }
    }
    s.facts = out;
  }
}

/**
 * 第 1 步：候选事件池（张楚寒：「每天先形成 30—80 个候选事件」）。
 *
 * 与被它取代的 `gatherMacro` + `gatherNews` 的区别不只是合并了两条取数：
 * 那两条各自按 importance 排序、各自截断，等于**两份互不知情的榜单**——
 * 个股公告 75 分永远压过「SK海力士 HBM4 扩产」70 分，宏观层被系统性挤掉，
 * 而重磅榜和宏观榜之间又会重复。现在只有一个池子，去重/分类/配额都在池子上做。
 *
 * 池子刻意放宽（importance ≥ 25、近 30 小时）：**质量交给排序和配额，不交给门槛**。
 * 绝对门槛跨层不可比——这是上一轮把国内宏观整层误杀 41/44 条学到的。
 */
async function gatherEventPool(db: DigestDb, hours = POOL_WINDOW_HOURS) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db.newsItem.findMany({
    where: { importance: { gte: POOL_MIN_IMPORTANCE }, publishedAt: { gte: since } },
    orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
    take: POOL_SCAN_TAKE,
    select: {
      id: true,
      title: true,
      brief: true,
      summary: true,
      importance: true,
      eventType: true,
      tier: true,
      publishedAt: true,
      source: { select: { name: true } },
      entities: {
        select: { entityId: true, entity: { select: { name: true, type: true } } },
      },
    },
  });

  const pool: RawEvent[] = [];
  for (const r of rows) {
    if (isInauspicious(r.title, r.eventType)) continue;
    if (!isDigestWorthyFiling(r.title)) continue;
    if (!isMarketLevelWorthy(r.title)) continue;
    pool.push({
      id: r.id,
      title: r.title,
      brief: (r.brief ?? r.summary ?? "").slice(0, 90),
      source: r.source.name,
      tier: r.tier,
      importance: r.importance,
      publishedAt: r.publishedAt,
      entityNames: r.entities.map((e) => cleanEntityName(e.entity.name)),
      entityIds: r.entities.map((e) => e.entityId),
      entityTypes: r.entities.map((e) => e.entity.type),
      eventType: r.eventType,
    });
  }
  return pool;
}

/**
 * 排序判据要用到的三个集合。这三样都是**当日实况**，不是词表——
 * 「与当日涨跌的解释力」「与用户持仓的相关度」「是否改变原有投资逻辑」
 * 分别由它们回答。
 */
async function gatherRankContext(
  db: DigestDb,
  sectors: { strong: DigestSectorIn[]; weak: DigestSectorIn[] },
  stocks: DigestStockIn[],
  now: Date,
): Promise<RankContext> {
  const hot = new Set<string>();
  for (const s of [...sectors.strong, ...sectors.weak]) {
    hot.add(s.name);
    for (const l of s.leaders) hot.add(cleanEntityName(l));
  }
  for (const s of stocks) hot.add(cleanEntityName(s.name));

  const [watched, touched] = await Promise.all([
    db.$queryRawUnsafe<{ name: string }[]>(`
      SELECT DISTINCT e.name FROM "Watchlist" w JOIN "Entity" e ON e.id = w."entityId"
    `),
    db.$queryRawUnsafe<{ newsId: string }[]>(
      `SELECT DISTINCT "newsId" FROM "ThesisSignal" WHERE "publishedAt" >= $1`,
      new Date(now.getTime() - POOL_WINDOW_HOURS * 60 * 60 * 1000),
    ),
  ]);

  return {
    now,
    hotSubjects: hot,
    heldSubjects: new Set(watched.map((w) => cleanEntityName(w.name))),
    thesisTouched: new Set(touched.map((t) => t.newsId)),
  };
}

export type PipelineResult = {
  events: ScoredEvent[];
  coverage: CoverageRow[];
  poolSize: number;
  mergedSize: number;
};

/**
 * 第 1–5 步跑完，交给第 6 步（模型）。**零 AI**：分类靠词表、聚类靠字符二元组、
 * 排序靠既有评分——张楚寒建议这几步用便宜模型，规则做得更省也更稳（可单测、确定性）。
 */
export function runEventPipeline(
  pool: RawEvent[],
  ctx: RankContext,
): PipelineResult {
  const merged = mergeEvents(pool); // 第 2 步：去重合并
  const scored = merged.map((m) =>
    scoreEvent({ ...m, category: categorize(m) }, ctx),
  ); // 第 3 步：分类 + 打分
  const picked = selectEvents(scored, {
    min: EVENTS_MIN,
    max: EVENTS_MAX,
    perCategoryFloor: EVENTS_PER_CATEGORY_FLOOR,
    perCategoryCap: EVENTS_PER_CATEGORY_CAP,
    perSubjectCap: EVENTS_PER_SUBJECT_CAP,
  }); // 第 5 步：选 15–25
  const coverage = coverageReport(scored, picked, EVENTS_PER_CATEGORY_FLOOR); // 第 4 步：查遗漏
  return { events: picked, coverage, poolSize: pool.length, mergedSize: merged.length };
}

/**
 * 盘前的候选池起点＝**昨天 A 股收盘那一刻**（15:00 CST）。用固定 30 小时窗口会把昨天盘中
 * 的事又捞一遍——那些昨天的收盘复盘已经讲过了，重复讲等于盘前简报没有增量。
 */
function lastCloseBefore(now: Date): Date {
  const d = new Date(now);
  d.setHours(15, 0, 0, 0);
  if (d.getTime() >= now.getTime()) d.setDate(d.getDate() - 1);
  return d;
}

export async function gatherDigestInputs(
  db: DigestDb,
  now = new Date(),
  session: DigestSession = "close",
): Promise<DigestInputs> {
  if (session === "preopen") return gatherPreopenInputs(db, now);
  const [indices, sectors, pool] = await Promise.all([
    fetchIndexQuotes(),
    gatherSectors(db),
    gatherEventPool(db),
  ]);
  const stocks = await gatherStocks(db, sectors.flows);
  // 板块 note 也需要事实支撑，否则只能写「板块走强」——取它代表股当日的消息面
  await attachSectorFacts(db, [...sectors.strong, ...sectors.weak]);

  // 第 1–5 步：候选池 → 去重合并 → 六类分类 → 打分排序 → 选 15–25 + 遗漏检查（零 AI）
  const ctx = await gatherRankContext(db, sectors, stocks, now);
  const pipeline = runEventPipeline(pool, ctx);
  return {
    tradeDate: tradeDateOf(now),
    market: "CN",
    session: "close",
    indices: indices.map((i) => ({
      label: i.label,
      price: i.price,
      changePct: i.changePct,
    })),
    // 指数会骗人：权重护盘时指数只跌 0.5%，个股可能 4000 只在跌。宽度是「今天什么盘」的骨架。
    breadth: sectors.flows.length > 0 ? summarizeBreadth(sectors.flows) : null,
    events: pipeline.events.map(toDigestEvent),
    coverage: pipeline.coverage,
    sectors: { strong: sectors.strong, weak: sectors.weak },
    stocks,
    // 催化节点是**全市场统一的法定披露截止日**（非个股预约日），所以 name 填报告期而非公司名。
    catalysts: upcomingDisclosureNodes(now, 4).map((n) => ({
      name: n.period,
      label: `${n.label}（法定披露截止，还有 ${n.daysUntil} 天）`,
      date: tradeDateOf(n.deadline),
    })),
  };
}

/**
 * 盘前取数。与收盘那份的差别是**数据面本身**，不是措辞：
 * 没有当日 A 股行情/板块资金/市场宽度（还没开盘），所以 sectors/stocks/breadth 一律为空，
 * 只留隔夜指数（`fetchIndexQuotes` 里本来就含道指/纳指/恒生）+ 昨收以来的事件池 + 今日日程。
 */
async function gatherPreopenInputs(
  db: DigestDb,
  now: Date,
): Promise<DigestInputs> {
  const since = lastCloseBefore(now);
  const hours = Math.max(1, (now.getTime() - since.getTime()) / 3_600_000);
  const [indices, pool] = await Promise.all([
    fetchIndexQuotes(),
    gatherEventPool(db, hours),
  ]);
  // 盘前没有「今日强弱板块」也没有持仓涨跌可比 —— hotSubjects 留空，
  // 其余两条判据（持仓相关度 / 是否改变投资逻辑）照常起作用。
  const ctx = await gatherRankContext(
    db,
    { strong: [], weak: [] },
    [],
    now,
  );
  const pipeline = runEventPipeline(pool, ctx);
  return {
    tradeDate: tradeDateOf(now),
    market: "CN",
    session: "preopen",
    indices: indices.map((i) => ({
      label: i.label,
      price: i.price,
      changePct: i.changePct,
    })),
    breadth: null,
    events: pipeline.events.map(toDigestEvent),
    coverage: pipeline.coverage,
    sectors: { strong: [], weak: [] },
    stocks: [],
    catalysts: upcomingDisclosureNodes(now, 4).map((n) => ({
      name: n.period,
      label: `${n.label}（法定披露截止，还有 ${n.daysUntil} 天）`,
      date: tradeDateOf(n.deadline),
    })),
  };
}

export type DigestResult = {
  status: "created" | "unchanged" | "rejected" | "no-data";
  tradeDate: string;
  data?: MarketDigestData;
  reason?: string;
};

/**
 * 生成并入库当日复盘。
 * - 同日同输入指纹 → `unchanged`，不重复烧 token
 * - 模型输出过不了合规校验（买卖指令 / 非双向 / 缺段）→ `rejected`，**不入库**：
 *   首屏顶一段残缺或越线的复盘，比没有更糟
 */
export async function generateMarketDigest(
  db: DigestDb,
  opts: { now?: Date; force?: boolean; session?: DigestSession } = {},
): Promise<DigestResult> {
  const now = opts.now ?? new Date();
  const session = opts.session ?? "close";
  const inputs = await gatherDigestInputs(db, now, session);
  const tradeDate = inputs.tradeDate;

  if (inputs.indices.length === 0 && inputs.events.length === 0) {
    return { status: "no-data", tradeDate, reason: "指数与事件池都取不到" };
  }

  const hash = digestInputHash(inputs);
  const existing = await db.marketDigest.findUnique({
    where: {
      tradeDate_market_session: { tradeDate, market: inputs.market, session },
    },
    select: { inputHash: true },
  });
  if (existing?.inputHash === hash && !opts.force) {
    return { status: "unchanged", tradeDate };
  }

  // 第 6 步：**只有这一次调用**用强模型档——前五步全是纯规则。
  // 事件从 ~10 条涨到 15–25 条，token 只涨在这一次 prompt 上，不涨调用次数（张楚寒的成本要求）。
  const raw = await llmChat(
    session === "preopen" ? PREOPEN_SYSTEM : DIGEST_SYSTEM,
    buildDigestPrompt(inputs),
    {
      maxTokens: 3200,
      tier: "strong",
    },
  );
  const data = parseDigestResponse(raw, inputs.breadth, inputs.stocks, [
    ...inputs.sectors.strong,
    ...inputs.sectors.weak,
  ]);
  if (!data) {
    return {
      status: "rejected",
      tradeDate,
      reason: `模型输出未通过校验（非 JSON / 缺段 / 含买卖指令 / 判断非双向 / 核心驱动全是废话）：${raw.slice(0, 160)}`,
    };
  }
  // 归因逐条核对（见 server/note-check）：个股与板块的 note 都要能在它自己的当日事实里找到依据。
  const factsOfStock = new Map(inputs.stocks.map((s) => [s.name, s.facts]));
  const factsOfSector = new Map(
    [...inputs.sectors.strong, ...inputs.sectors.weak].map((s) => [s.name, s.facts]),
  );
  await groundNotes(
    [
      ...data.stocks
        .filter((s) => s.note)
        .map((s) => ({
          item: { subject: s.name, facts: factsOfStock.get(s.name) ?? [], note: s.note },
          clear: () => {
            s.note = "";
          },
        })),
      ...[...data.sectors.strong, ...data.sectors.weak]
        .filter((s) => s.note)
        .map((s) => ({
          item: {
            subject: s.name,
            kind: "sector" as const,
            facts: factsOfSector.get(s.name) ?? [],
            note: s.note,
          },
          clear: () => {
            s.note = "";
          },
        })),
    ],
    `市场复盘 ${tradeDate}`,
  );

  const payload = {
    overview: data.overview,
    drivers: data.drivers,
    sectors: data.sectors,
    stocks: data.stocks,
    watchpoints: data.watchpoints,
    judgment: data.judgment,
    // 宽度是代码算的，与 AI 文字分开存：模型不产出数字（铁律：数字由代码算）
    stats: data.breadth ?? undefined,
    inputHash: hash,
    model: llmModel("strong"),
  };
  await db.marketDigest.upsert({
    where: {
      tradeDate_market_session: { tradeDate, market: inputs.market, session },
    },
    create: { tradeDate, market: inputs.market, session, ...payload },
    update: payload,
  });
  // 管线选了 N 条事件、模型只写了 M 条 driver —— M 远小于 N 说明它把筛选又做了一遍，
  // 而这在成品上跟「今天没什么事」完全同形。报出来，别让它静默。
  if (data.drivers.length < Math.min(inputs.events.length, EVENTS_MIN) * 0.6) {
    console.warn(
      `[digest] ⚠ 事件 ${inputs.events.length} 条 → driver 仅 ${data.drivers.length} 条：模型压缩了内容，或判据滤掉太多`,
    );
  }
  return { status: "created", tradeDate, data };
}
