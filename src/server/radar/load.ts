import type { PrismaClient } from "../../../generated/prisma";
import type { StockSeries } from "../../lib/radar/aggregate";
import type { StockBasics } from "../../lib/radar/select";
import {
  pickCatalysts,
  mergeGraded,
  type CatalystNews,
  type CatalystPick,
  type GradedCatalyst,
} from "../../lib/radar/catalyst";
import type { RadarBar } from "../../lib/radar/series";

/**
 * 机会雷达的取数层：`MarketDaily` + 板块归属 + 近 3 日资讯 → 引擎的输入。
 *
 * 相对导入（不用 `~` 别名）：让 `src/scripts/*.ts` 走 tsx 也能引用。
 * 这一层只做取数与整形，**不做任何判断**——判断全在 `lib/radar/engine.ts` 里，
 * 那样才测得动。
 */

/** 催化取材窗口（交易日之外还有周末，按自然日给 4 天）。 */
const CATALYST_DAYS = 4;
/** 每条信号最多带几条证据。 */
const MAX_EVIDENCE = 3;

export type LoadedMarket = {
  stocks: StockSeries[];
  stockBasics: Map<string, StockBasics>;
  floatCapByTicker: Map<string, number>;
  catalystsByTicker: Map<string, CatalystPick>;
  catalystsBySector: Map<string, CatalystPick>;
  /** 最新交易日 YYYY-MM-DD */
  latestTradeDate: string | null;
  /** 个股 ticker → 它的孪生 COMPANY 实体 id（去重用） */
  companyIdByTicker: Map<string, string>;
};

type DailyRow = {
  ticker: string;
  entityId: string;
  name: string;
  tradeDate: Date;
  close: number;
  changePct: number;
  amount: number | null;
  netAmount: number | null;
  netRatio: number | null;
  turnoverRate: number | null;
};

/** DATE 列以 UTC 零点存取，取日历日一律走 UTC，别用本地时区（会差一天）。 */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function loadMarket(
  db: PrismaClient,
  opts: { days?: number; asOf?: string } = {},
): Promise<LoadedMarket> {
  const days = opts.days ?? 60;

  /**
   * **先定市场日历，再取行**——这是实跑才暴露的坑：长期停牌股的 60 行会横跨一年，
   * 直接按「每只股自己的第 21 行」当"20 个交易日前"，量出来的是一年前的价。
   * 库里 `MarketDaily` 有 375 个不同日期，真正的交易日只有最近这 60 个；
   * 判据是**当天有多少只股成交**（停牌股的老日期只有个位数行）。
   */
  const calRows = await db.$queryRawUnsafe<{ d: Date; n: bigint }[]>(
    `SELECT "tradeDate" d, count(*) n FROM "MarketDaily"
      ${opts.asOf ? `WHERE "tradeDate" <= '${opts.asOf}'::date` : ""}
      GROUP BY 1 ORDER BY 1 DESC LIMIT $1`,
    days + 20,
  );
  const peak = Number(calRows[0]?.n ?? 0n);
  const calendar = calRows
    .filter((r) => Number(r.n) >= peak * 0.6)
    .slice(0, days)
    .map((r) => dayKey(r.d));
  if (calendar.length === 0)
    return {
      stocks: [],
      stockBasics: new Map(),
      floatCapByTicker: new Map(),
      catalystsByTicker: new Map(),
      catalystsBySector: new Map(),
      latestTradeDate: null,
      companyIdByTicker: new Map(),
    };

  const rows = await db.$queryRawUnsafe<DailyRow[]>(
    `SELECT m.ticker, m."entityId", e.name, m."tradeDate", m.close, m."changePct",
            m.amount, m."netAmount", m."netRatio", m."turnoverRate"
       FROM "MarketDaily" m
       JOIN "Entity" e ON e.id = m."entityId"
      WHERE m."tradeDate" = ANY($1::date[])
      ORDER BY m.ticker, m."tradeDate" ASC`,
    calendar,
  );

  const membership = await db.$queryRawUnsafe<
    { ticker: string; sector: string }[]
  >(`
    SELECT st.ticker, sec.name AS sector
      FROM "EntityRelation" r
      JOIN "Entity" st  ON st.id  = r."fromId" AND st.type  = 'STOCK'
      JOIN "Entity" sec ON sec.id = r."toId"   AND sec.type = 'SECTOR'
     WHERE r.type = 'BELONGS_TO' AND st.ticker IS NOT NULL
  `);
  // 一只股可能挂多个板块；取第一个（库里绝大多数一对一，与 rotation.ts 同口径）
  const sectorOf = new Map<string, string>();
  for (const m of membership) if (!sectorOf.has(m.ticker)) sectorOf.set(m.ticker, m.sector);

  // COMPANY↔STOCK 孪生：去重键用得上（同一家公司不得以两个实体重复入选）
  const pairs = await db.$queryRawUnsafe<{ ticker: string; companyId: string }[]>(`
    SELECT st.ticker, co.id AS "companyId"
      FROM "EntityRelation" r
      JOIN "Entity" co ON co.id = r."fromId" AND co.type = 'COMPANY'
      JOIN "Entity" st ON st.id = r."toId"   AND st.type = 'STOCK'
     WHERE r.type = 'ISSUES' AND st.ticker IS NOT NULL
  `);
  const companyIdByTicker = new Map(pairs.map((p) => [p.ticker, p.companyId]));

  // ---- 逐股整形 -----------------------------------------------------------
  const byTicker = new Map<string, DailyRow[]>();
  for (const r of rows) {
    const arr = byTicker.get(r.ticker);
    if (arr) arr.push(r);
    else byTicker.set(r.ticker, [r]);
  }

  let latestTradeDate: string | null = null;
  const stocks: StockSeries[] = [];
  const stockBasics = new Map<string, StockBasics>();
  const floatCapByTicker = new Map<string, number>();

  for (const [ticker, rs] of byTicker) {
    const bars: RadarBar[] = rs.map((r) => ({
      day: dayKey(r.tradeDate),
      close: r.close,
      changePct: r.changePct,
      amount: r.amount,
      netAmount: r.netAmount,
      netRatio: r.netRatio,
      turnoverRate: r.turnoverRate,
    }));
    const last = bars[bars.length - 1]!;
    if (!latestTradeDate || last.day > latestTradeDate) latestTradeDate = last.day;

    stocks.push({
      ticker,
      entityId: rs[0]!.entityId,
      name: rs[0]!.name,
      sector: sectorOf.get(ticker) ?? null,
      bars,
    });

    // 20 日均成交额
    const amt20 = bars
      .slice(-20)
      .map((b) => b.amount)
      .filter((v): v is number => v !== null && v > 0);
    /**
     * 机械性异动（除权/复牌）判定要**窄**：A 股 6~7 月是分红季，60 日窗口里
     * 21% 的股都有除息缺口——按「对不上就排除」会把五分之一的市场删掉，而分红
     * 本身完全不影响这只股值不值得看（收益已经改用官方涨跌幅连乘，除息不再污染）。
     * 只挡真正会让**短窗口比较失真**的那种：最近 5 个交易日内，收盘价跳变
     * 超过任何板块的日内涨跌幅上限（>11%）却没有对应的涨跌幅——那是复牌或缩股。
     */
    let gap = false;
    for (let i = Math.max(1, bars.length - 5); i < bars.length; i++) {
      const prev = bars[i - 1]!.close;
      const cur = bars[i]!;
      if (prev > 0) {
        const implied = (cur.close / prev - 1) * 100;
        if (Math.abs(implied - cur.changePct) > 11) gap = true;
      }
    }
    stockBasics.set(ticker, {
      name: rs[0]!.name,
      barCount: bars.length,
      avgAmount20:
        amt20.length >= 10 ? amt20.reduce((a, b) => a + b, 0) / amt20.length : null,
      suspended: false, // 下面按最新交易日统一判
      oneWordLimitUp: false, // 由 limit-shape.ts 对最终候选逐个核
      priceGapAnomaly: gap,
    });

    // 流通市值 = 成交额 ÷ 换手率。不用再去打一趟第三方——这两个字段本来就在库里。
    // （实测 000812：1.43 亿 ÷ 5.39% = 26.5 亿，腾讯快照 26.39 亿）
    if (last.amount && last.turnoverRate && last.turnoverRate > 0.01)
      floatCapByTicker.set(ticker, last.amount / (last.turnoverRate / 100));
  }

  // 停牌：最新交易日没有这只股的行
  for (const s of stocks) {
    const b = stockBasics.get(s.ticker)!;
    b.suspended = s.bars[s.bars.length - 1]!.day !== latestTradeDate;
  }

  // ---- 催化（近 4 天资讯）-------------------------------------------------
  /**
   * 回测时资讯也必须**截到那一天**——否则用今天的公告去解释一个月前的信号，
   * 就是典型的前视偏差（look-ahead），回测出来的效果全是假的。
   * `until` 取 asOf 当天 23:59:59（那天收盘后发的公告，对次日交易是可见的）。
   */
  const until = opts.asOf
    ? new Date(`${opts.asOf}T23:59:59.999Z`)
    : new Date();
  const since = new Date(until.getTime() - CATALYST_DAYS * 24 * 3600 * 1000);
  const newsRows = await db.$queryRawUnsafe<
    {
      id: string;
      title: string;
      url: string;
      publishedAt: Date;
      importance: number;
      eventType: string | null;
      sourceName: string;
      tier: string;
      entityId: string;
      entityType: string;
      entityName: string;
      ticker: string | null;
      boundCount: bigint;
    }[]
  >(
    `
    SELECT n.id, n.title, n.url, n."publishedAt", n.importance, n."eventType",
           s.name AS "sourceName", s.tier::text AS tier,
           e.id AS "entityId", e.type::text AS "entityType", e.name AS "entityName", e.ticker,
           (SELECT count(*) FROM "NewsEntity" x WHERE x."newsId" = n.id) AS "boundCount"
      FROM "NewsItem" n
      JOIN "Source" s ON s.id = n."sourceId"
      JOIN "NewsEntity" ne ON ne."newsId" = n.id
      JOIN "Entity" e ON e.id = ne."entityId"
     WHERE n."publishedAt" >= $1 AND n."publishedAt" <= $2
       AND e.type IN ('COMPANY','STOCK','SECTOR')
     ORDER BY n."publishedAt" DESC
  `,
    since,
    until,
  );

  const { catalystsByTicker, catalystsBySector } = buildCatalysts({
    newsRows,
    sectorOf,
    companyIdByTicker,
    nameByTicker: new Map(stocks.map((x) => [x.ticker, x.name])),
  });

  return {
    stocks,
    stockBasics,
    floatCapByTicker,
    catalystsByTicker,
    catalystsBySector,
    latestTradeDate,
    companyIdByTicker,
  };
}


export type RawNewsRow = {
  id: string;
  title: string;
  url: string;
  publishedAt: Date;
  importance: number;
  eventType: string | null;
  sourceName: string;
  tier: string;
  entityId: string;
  entityType: string;
  entityName: string;
  ticker: string | null;
  boundCount: bigint;
};

/**
 * 资讯行 → 催化映射。**抽出来是为了回测能复用**：回测要回放几十个交易日，
 * 如果每天都重新查一次库，进程会跑成十几分钟然后被系统回收（实测 29 天只跑完 10 天
 * 就被杀）。现在一次把资讯全查回来，逐日在内存里按 `publishedAt` 切窗口。
 */
export function buildCatalysts(i: {
  newsRows: RawNewsRow[];
  sectorOf: Map<string, string>;
  companyIdByTicker: Map<string, string>;
  nameByTicker: Map<string, string>;
}): {
  catalystsByTicker: Map<string, CatalystPick>;
  catalystsBySector: Map<string, CatalystPick>;
} {
  const { newsRows, sectorOf, companyIdByTicker, nameByTicker } = i;
  // COMPANY 实体 id → ticker（资讯多绑在 COMPANY 上，个股信号要取得到）
  const tickerByCompanyId = new Map<string, string>();
  for (const [ticker, cid] of companyIdByTicker) tickerByCompanyId.set(cid, ticker);

  const newsByTicker = new Map<string, CatalystNews[]>();
  const newsBySector = new Map<string, CatalystNews[]>();
  for (const r of newsRows) {
    const item: CatalystNews = {
      id: r.id,
      title: r.title,
      sourceName: r.sourceName,
      tier: r.tier,
      url: r.url,
      publishedAt: r.publishedAt,
      importance: r.importance,
      eventType: r.eventType,
      boundCount: Number(r.boundCount),
    };
    if (r.entityType === "SECTOR") {
      const arr = newsBySector.get(r.entityName);
      if (arr) arr.push(item);
      else newsBySector.set(r.entityName, [item]);
      continue;
    }
    const ticker = r.ticker ?? tickerByCompanyId.get(r.entityId) ?? null;
    if (!ticker) continue;
    const arr = newsByTicker.get(ticker);
    if (arr) arr.push(item);
    else newsByTicker.set(ticker, [item]);
  }

  const catalystsByTicker = new Map<string, CatalystPick>();
  for (const [ticker, items] of newsByTicker)
    // 传主体名：标题带「别人家：」前缀的媒体稿不算这家公司的催化
    catalystsByTicker.set(
      ticker,
      pickCatalysts(items, MAX_EVIDENCE, nameByTicker.get(ticker)),
    );

  /**
   * 板块催化 = 板块自身的资讯 + 成分股的资讯，但**降级规则**很重要：
   * 一家成分股发了份公告，不等于整个行业有催化。实跑第一版三个行业全是「高」，
   * 就是因为把任意一只成员的公告直接算成了行业级催化——那是在拿个股事实
   * 给行业结论背书。所以：行业级「高」只在两种情况成立——
   *   ① 有绑在**板块实体**上的一手资讯（真正的行业新闻）；
   *   ② 至少 **2 家不同成分公司**同时出现「高」级催化（行业性的事在扩散）。
   * 否则整体等级封顶到「中」。
   */
  const catalystsBySector = new Map<string, CatalystPick>();
  const sectors = new Set([...newsBySector.keys()]);
  for (const ticker of newsByTicker.keys()) {
    const s = sectorOf.get(ticker);
    if (s) sectors.add(s);
  }
  for (const sector of sectors) {
    const sectorOwn = newsBySector.get(sector) ?? [];
    const memberItems: GradedCatalyst[] = [];
    const highCompanies = new Set<string>();
    for (const [ticker] of newsByTicker) {
      if (sectorOf.get(ticker) !== sector) continue;
      const pick = catalystsByTicker.get(ticker);
      if (!pick) continue;
      /**
       * 用**已经过主体校验的**个股证据，不是原始 newsByTicker。
       * 实跑第一版「银行」的催化是「新北洋：中标工商银行网点终端项目」——
       * 那是供应商卖设备给工行，绑在工行身上，跟银行业的景气毫无关系。
       * 个股那层的主体校验早就把它判掉了，是这里绕过了它又捡回来。
       */
      memberItems.push(...pick.items);
      if (pick.grade === "HIGH") highCompanies.add(ticker);
    }
    // 板块自身的资讯也做主体校验：主体写着别家公司的稿子不是这个行业的催化
    const ownPick = pickCatalysts(sectorOwn, MAX_EVIDENCE, sector);
    const merged = mergeGraded([ownPick.items, memberItems], MAX_EVIDENCE);
    const industryWide = ownPick.grade === "HIGH" || highCompanies.size >= 2;
    catalystsBySector.set(sector, {
      ...merged,
      grade:
        merged.grade === "HIGH" && !industryWide
          ? "MEDIUM" // 只有一家公司的公告——是个股催化，不是行业催化
          : merged.grade,
    });
  }
  return { catalystsByTicker, catalystsBySector };
}
