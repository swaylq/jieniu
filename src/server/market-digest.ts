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
  DIGEST_SYSTEM,
  type DigestInputs,
  type DigestNewsIn,
  type DigestStockIn,
  type DigestSectorIn,
  type MarketDigestData,
} from "../lib/market-digest";
import { aggregateSectors, rankSectors, type StockFlow } from "../lib/rotation";
import { rankDigest, isInauspicious, type DigestCandidate } from "../lib/digest-filter";
import {
  summarizeBreadth,
  isMarketLevelWorthy,
  type MacroCandidate,
} from "../lib/digest-substance";
import { rankMacroCandidates } from "../lib/macro-relevance";
import { upcomingDisclosureNodes } from "../lib/earnings-calendar";
import { fetchIndexQuotes } from "./quote";
import { llmChat, llmModel } from "./llm";

const NEWS_WINDOW_HOURS = 24;
const NEWS_TAKE = 10;
const SECTOR_TAKE = 4;
const STOCK_TAKE = 8;
/** 市场级条目每层取几条（海外 / 国内 / 产业各自独立配额，避免一层挤掉另一层）。 */
const MACRO_PER_SCOPE = 6;
/** 同一主体在同一层最多几条——不设这个上限，海外层会被同一件事的连续追更占满。 */
const MACRO_PER_SUBJECT = 2;
/**
 * 市场级候选的 importance 下限。**刻意压到 30**（=未打分的默认值）：不绑个股的条目
 * 大半挤在这一档，门槛卡在 40 会把「SK海力士跌逾17%」「美联储将公布决议」一起扔掉。
 * 质量交给 `marketRelevanceScore` 排序，不交给门槛。
 */
const MACRO_MIN_IMPORTANCE = 30;
/** 扫描上限：全市场一天资讯 2500+ 条，取 1200 会在高分档就截断，宏观层永远扫不到。 */
const MACRO_SCAN_TAKE = 3000;
/**
 * 「好料」的相关性下限。**刻意定得低**：门槛的活是「把噪音挡在外面」，
 * 而噪音应该由评分本身判成负分（行政通报 -6、工商登记 -4、指数复述 -6），不该由门槛兜。
 *
 * 一开始定的是 6，实测踩了坑：国内宏观层 44 条候选被挡掉 41 条，其中
 * 「《国家应对气候变化十五五规划》」「央行上海总部：贷款余额同比增长5.9%」都是真·当天宏观事件——
 * 因为 6 分是按产业事件（有动作＋有金额）标定的，而政策类天生拿不到那么高。
 * **绝对门槛跨层不可比**，所以门槛降到 3，质量交给排序 + 每层配额。
 */
const MACRO_MIN_RELEVANCE = 3;
/** 每层兜底条数：好料不足时从次一档补，防止我手写的评分词表有洞把整层静默清空。 */
const MACRO_FLOOR_PER_SCOPE = 3;
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
    { ticker: string | null; name: string; title: string; importance: number }[]
  >(
    `
    SELECT e.ticker, e.name, n.title, n.importance
    FROM "NewsItem" n
    JOIN "NewsEntity" ne ON ne."newsId" = n.id
    JOIN "Entity" e ON e.id = ne."entityId"
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
 * 国际 / 国内宏观 / 产业三层素材（张楚寒：「我想要这里放信息量，就是国际市场有啥大事、
 * 国内整体有啥大事，汇总一下当天市场重要信息」）。
 *
 * 判据是**没绑定任何个股**（板块绑定不算）——市场级新闻不会绑到某家公司上，而个股公告一定绑。
 * 这条比关键词稳，也正好避开既有 `gatherNews` 的问题：那条链路按 importance 排，个股公告
 * 75 分永远压过「SK海力士 HBM4 扩产」70 分，宏观层被系统性挤掉。
 *
 * 2026-07-30（sway：「还是觉得这块信息不足」）三处放开，每处都有实测数字：
 *   ① 判据从「零绑定」改成「不绑个股」。原来那条把**只绑板块**的宏观新闻整批排除了——
 *      近 24h 有 36 条，里面是「美联储利率决议即将公布」「SK海力士电话会」「欧洲股市多数走高」，
 *      即当天最该讲的海外主线。池子 29 → 58 条。
 *   ② importance 门槛 40 → 30。这不是放水：库里 681 条不绑个股的条目挤在 importance=30
 *      这一默认档，其中既有「SK海力士跌逾17%」也有「釜山破122年最高气温」——importance
 *      在这一档没有鉴别力，得靠 `marketRelevanceScore` 去分辨，不能靠门槛一刀切掉。
 *   ③ 排序主键从 importance 换成相关性（`rankMacroCandidates`），并给同一主体设上限：
 *      原来海外 5 个位置里 4 个是韩股熔断的连续追更。
 */
async function gatherMacro(db: DigestDb) {
  const since = new Date(Date.now() - NEWS_WINDOW_HOURS * 60 * 60 * 1000);
  const rows = await db.newsItem.findMany({
    where: { importance: { gte: MACRO_MIN_IMPORTANCE }, publishedAt: { gte: since } },
    orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
    take: MACRO_SCAN_TAKE,
    select: {
      title: true,
      brief: true,
      summary: true,
      eventType: true,
      importance: true,
      source: { select: { name: true } },
      entities: { select: { entity: { select: { type: true } } } },
    },
  });
  const cands: MacroCandidate[] = rows
    // 「市场级」= 不绑任何**个股**。绑了板块（SECTOR）的仍然是市场级——一条「美股半导体概念股
    // 走强，美联储将公布决议」会被打上半导体板块标签，但它讲的不是某家公司。
    .filter((r) =>
      r.entities.every((e) => e.entity.type !== "COMPANY" && e.entity.type !== "STOCK"),
    )
    .filter((r) => !isInauspicious(r.title, r.eventType))
    .map((r) => ({
      title: r.title,
      brief: (r.brief ?? r.summary ?? "").slice(0, 90),
      source: r.source.name,
      importance: r.importance,
    }));
  return rankMacroCandidates(cands, {
    perScope: MACRO_PER_SCOPE,
    perSubject: MACRO_PER_SUBJECT,
    minScore: MACRO_MIN_RELEVANCE,
    floorPerScope: MACRO_FLOOR_PER_SCOPE,
  });
}

/** 今日重磅：复用早报选材（剔退市晦气、宏观加权、同主体折叠）。 */
async function gatherNews(db: DigestDb): Promise<DigestNewsIn[]> {
  const since = new Date(Date.now() - NEWS_WINDOW_HOURS * 60 * 60 * 1000);
  const rows = await db.newsItem.findMany({
    where: { importance: { gte: 55 }, publishedAt: { gte: since } },
    orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
    take: 60,
    select: {
      id: true,
      title: true,
      brief: true,
      summary: true,
      importance: true,
      eventType: true,
      publishedAt: true,
      source: { select: { name: true } },
      entities: { select: { entityId: true, entity: { select: { type: true } } } },
    },
  });
  const briefById = new Map(rows.map((r) => [r.id, r.brief ?? r.summary ?? ""]));
  const cands: DigestCandidate[] = rows
    // 复盘只要市场级事件：剔掉募集资金开户 / 监管协议 / 中介核查意见这类纯事务性文件
    .filter((r) => isDigestWorthyFiling(r.title))
    .map((r) => ({
      id: r.id,
      title: r.title,
      importance: r.importance,
      eventType: r.eventType,
      publishedAt: r.publishedAt,
      hasEntity: r.entities.length > 0,
      entityKeys: r.entities
        .filter((e) => e.entity.type === "COMPANY" || e.entity.type === "STOCK")
        .map((e) => e.entityId),
      source: { name: r.source.name },
    }));
  return rankDigest(cands, NEWS_TAKE).map((c) => ({
    title: c.title,
    source: c.source.name,
    brief: (briefById.get(c.id) ?? "").slice(0, 80),
  }));
}

export async function gatherDigestInputs(
  db: DigestDb,
  now = new Date(),
): Promise<DigestInputs> {
  const [indices, sectors, news, macro] = await Promise.all([
    fetchIndexQuotes(),
    gatherSectors(db),
    gatherNews(db),
    gatherMacro(db),
  ]);
  const stocks = await gatherStocks(db, sectors.flows);
  // 板块 note 也需要事实支撑，否则只能写「板块走强」——取它代表股当日的消息面
  await attachSectorFacts(db, [...sectors.strong, ...sectors.weak]);
  return {
    tradeDate: tradeDateOf(now),
    market: "CN",
    indices: indices.map((i) => ({
      label: i.label,
      price: i.price,
      changePct: i.changePct,
    })),
    // 指数会骗人：权重护盘时指数只跌 0.5%，个股可能 4000 只在跌。宽度是「今天什么盘」的骨架。
    breadth: sectors.flows.length > 0 ? summarizeBreadth(sectors.flows) : null,
    macro,
    sectors: { strong: sectors.strong, weak: sectors.weak },
    stocks,
    news,
    // 催化节点是**全市场统一的法定披露截止日**（非个股预约日），所以 name 填报告期而非公司名。
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
  opts: { now?: Date; force?: boolean } = {},
): Promise<DigestResult> {
  const now = opts.now ?? new Date();
  const inputs = await gatherDigestInputs(db, now);
  const tradeDate = inputs.tradeDate;

  if (inputs.indices.length === 0 && inputs.news.length === 0) {
    return { status: "no-data", tradeDate, reason: "指数与资讯都取不到" };
  }

  const hash = digestInputHash(inputs);
  const existing = await db.marketDigest.findUnique({
    where: { tradeDate_market: { tradeDate, market: inputs.market } },
    select: { inputHash: true },
  });
  if (existing?.inputHash === hash && !opts.force) {
    return { status: "unchanged", tradeDate };
  }

  const raw = await llmChat(DIGEST_SYSTEM, buildDigestPrompt(inputs), {
    maxTokens: 2000,
  });
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
    model: llmModel(),
  };
  await db.marketDigest.upsert({
    where: { tradeDate_market: { tradeDate, market: inputs.market } },
    create: { tradeDate, market: inputs.market, ...payload },
    update: payload,
  });
  return { status: "created", tradeDate, data };
}
