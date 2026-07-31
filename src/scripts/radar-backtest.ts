// 机会雷达信号回测（需求 §12）。
// 用法：NODE_ENV=development npx tsx src/scripts/radar-backtest.ts [--days=30] [--horizon=10]
//
// 做法：**一次性把行情与资讯全查回来**，再逐个历史交易日在内存里切窗口回放引擎，
// 用信号日之后的行情算 1/3/5/10 日收益、相对全A/行业的超额、最大回撤、次日资金反转率。
//
// 为什么不逐日调 loadMarket：那样 29 个交易日要查 29 次全市场，进程跑到十几分钟
// 会被系统回收（实测只跑完 10 天就被杀，无任何报错）。同「长回填要有界分片」那条教训。
//
// 只读，不落库——回测脚本不该改生产数据。

import { PrismaClient } from "../../generated/prisma";
import { buildCatalysts, type RawNewsRow } from "../server/radar/load";
import { runRadar } from "../lib/radar/engine";
import { aggregateSector } from "../lib/radar/aggregate";
import type { StockSeries } from "../lib/radar/aggregate";
import type { StockBasics } from "../lib/radar/select";
import {
  evaluateSignal,
  summarize,
  WINDOWS,
  type ForwardResult,
} from "../lib/radar/backtest";
import type { RadarBar } from "../lib/radar/series";

const db = new PrismaClient();
/** 与 `server/radar/load.ts` 保持一致：引擎每次只看最近 60 个交易日。 */
const WINDOW = 60;
/** 催化取材窗口（自然日）。 */
const CATALYST_DAYS = 4;

function arg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) ? v : dflt;
}
function pct(v: number | undefined): string {
  return v === undefined ? "  —  " : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const backDays = arg("days", 30);
  const horizon = arg("horizon", 10);

  // ---- 一次性取数 ---------------------------------------------------------
  const calRows = await db.$queryRawUnsafe<{ d: Date; n: bigint }[]>(
    `SELECT "tradeDate" d, count(*) n FROM "MarketDaily" GROUP BY 1 ORDER BY 1 DESC LIMIT 200`,
  );
  const peak = Number(calRows[0]?.n ?? 0n);
  const calendar = calRows
    .filter((r) => Number(r.n) >= peak * 0.6)
    .map((r) => dayKey(r.d))
    .sort();
  const idxOfDay = new Map(calendar.map((d, i) => [d, i]));
  console.log(
    `[backtest] 市场日历 ${calendar.length} 天：${calendar[0]} → ${calendar[calendar.length - 1]}`,
  );

  const rows = await db.$queryRawUnsafe<
    {
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
    }[]
  >(
    `SELECT m.ticker, m."entityId", e.name, m."tradeDate", m.close, m."changePct",
            m.amount, m."netAmount", m."netRatio", m."turnoverRate"
       FROM "MarketDaily" m JOIN "Entity" e ON e.id = m."entityId"
      WHERE m."tradeDate" = ANY($1::date[])
      ORDER BY m.ticker, m."tradeDate" ASC`,
    calendar,
  );
  const membership = await db.$queryRawUnsafe<{ ticker: string; sector: string }[]>(
    `SELECT st.ticker, sec.name AS sector
       FROM "EntityRelation" r
       JOIN "Entity" st ON st.id = r."fromId" AND st.type = 'STOCK'
       JOIN "Entity" sec ON sec.id = r."toId" AND sec.type = 'SECTOR'
      WHERE r.type = 'BELONGS_TO' AND st.ticker IS NOT NULL`,
  );
  const sectorOf = new Map<string, string>();
  for (const m of membership) if (!sectorOf.has(m.ticker)) sectorOf.set(m.ticker, m.sector);

  const pairs = await db.$queryRawUnsafe<{ ticker: string; companyId: string }[]>(
    `SELECT st.ticker, co.id AS "companyId"
       FROM "EntityRelation" r
       JOIN "Entity" co ON co.id = r."fromId" AND co.type = 'COMPANY'
       JOIN "Entity" st ON st.id = r."toId" AND st.type = 'STOCK'
      WHERE r.type = 'ISSUES' AND st.ticker IS NOT NULL`,
  );
  const companyIdByTicker = new Map(pairs.map((p) => [p.ticker, p.companyId]));

  const allNews = await db.$queryRawUnsafe<RawNewsRow[]>(
    `SELECT n.id, n.title, n.url, n."publishedAt", n.importance, n."eventType",
            s.name AS "sourceName", s.tier::text AS tier,
            e.id AS "entityId", e.type::text AS "entityType", e.name AS "entityName", e.ticker,
            (SELECT count(*) FROM "NewsEntity" x WHERE x."newsId" = n.id) AS "boundCount"
       FROM "NewsItem" n
       JOIN "Source" s ON s.id = n."sourceId"
       JOIN "NewsEntity" ne ON ne."newsId" = n.id
       JOIN "Entity" e ON e.id = ne."entityId"
      WHERE n."publishedAt" >= $1
        AND e.type IN ('COMPANY','STOCK','SECTOR')
      ORDER BY n."publishedAt" DESC`,
    new Date(`${calendar[0]}T00:00:00.000Z`),
  );
  console.log(`[backtest] 行情 ${rows.length} 行 · 资讯绑定 ${allNews.length} 条`);

  // 逐股序列
  const byTicker = new Map<string, RadarBar[]>();
  const meta = new Map<string, { entityId: string; name: string }>();
  for (const r of rows) {
    const bar: RadarBar = {
      day: dayKey(r.tradeDate),
      close: r.close,
      changePct: r.changePct,
      amount: r.amount,
      netAmount: r.netAmount,
      netRatio: r.netRatio,
      turnoverRate: r.turnoverRate,
    };
    const arr = byTicker.get(r.ticker);
    if (arr) arr.push(bar);
    else {
      byTicker.set(r.ticker, [bar]);
      meta.set(r.ticker, { entityId: r.entityId, name: r.name });
    }
  }
  const nameByTicker = new Map(
    [...meta.entries()].map(([t, m]) => [t, m.name] as const),
  );

  // 全 A 等权净值 + 各板块合成序列（用完整日历算一次）
  const marketBars: RadarBar[] = calendar.map((day) => {
    const chgs: number[] = [];
    for (const bars of byTicker.values()) {
      const b = bars.find((x) => x.day === day);
      if (b) chgs.push(b.changePct);
    }
    return {
      day,
      close: 0,
      changePct: chgs.length ? chgs.reduce((a, b) => a + b, 0) / chgs.length : 0,
      amount: null,
      netAmount: null,
      netRatio: null,
      turnoverRate: null,
    };
  });
  const fullSeries: StockSeries[] = [...byTicker.entries()].map(([ticker, bars]) => ({
    ticker,
    entityId: meta.get(ticker)!.entityId,
    name: meta.get(ticker)!.name,
    sector: sectorOf.get(ticker) ?? null,
    bars,
  }));
  const sectorSeries = new Map<string, RadarBar[]>();
  {
    const bySec = new Map<string, StockSeries[]>();
    for (const s of fullSeries) {
      if (!s.sector) continue;
      const a = bySec.get(s.sector);
      if (a) a.push(s);
      else bySec.set(s.sector, [s]);
    }
    for (const [name, members] of bySec) {
      const agg = aggregateSector(name, members);
      if (agg) sectorSeries.set(name, agg.synthetic);
    }
  }

  // ---- 逐日回放 -----------------------------------------------------------
  const last = calendar.length - 1 - horizon;
  const first = Math.max(WINDOW, last - backDays + 1);
  const dates = calendar.slice(first, last + 1);
  console.log(
    `[backtest] 回放 ${dates.length} 个交易日（${dates[0]} → ${dates[dates.length - 1]}），前瞻 ${horizon} 天\n`,
  );

  const byType = new Map<string, ForwardResult[]>();
  const detail: string[] = [];
  let total = 0;

  for (const day of dates) {
    const dayIdx = idxOfDay.get(day)!;
    const windowDays = new Set(calendar.slice(Math.max(0, dayIdx - WINDOW + 1), dayIdx + 1));

    const stocks: StockSeries[] = [];
    const stockBasics = new Map<string, StockBasics>();
    const floatCapByTicker = new Map<string, number>();
    for (const s of fullSeries) {
      const bars = s.bars.filter((b) => windowDays.has(b.day));
      if (bars.length === 0) continue;
      stocks.push({ ...s, bars });
      const lastBar = bars[bars.length - 1]!;
      const amt20 = bars
        .slice(-20)
        .map((b) => b.amount)
        .filter((v): v is number => v !== null && v > 0);
      let gap = false;
      for (let i = Math.max(1, bars.length - 5); i < bars.length; i++) {
        const prev = bars[i - 1]!.close;
        if (prev > 0 && Math.abs((bars[i]!.close / prev - 1) * 100 - bars[i]!.changePct) > 11)
          gap = true;
      }
      stockBasics.set(s.ticker, {
        name: s.name,
        barCount: bars.length,
        avgAmount20:
          amt20.length >= 10 ? amt20.reduce((a, b) => a + b, 0) / amt20.length : null,
        suspended: lastBar.day !== day,
        oneWordLimitUp: false, // 回测不拉 K 线（每天几十次外网请求不现实）——见下方"口径说明"
        priceGapAnomaly: gap,
      });
      if (lastBar.amount && lastBar.turnoverRate && lastBar.turnoverRate > 0.01)
        floatCapByTicker.set(s.ticker, lastBar.amount / (lastBar.turnoverRate / 100));
    }

    const until = new Date(`${day}T23:59:59.999Z`);
    const since = new Date(until.getTime() - CATALYST_DAYS * 24 * 3600 * 1000);
    const newsRows = allNews.filter(
      (n) => n.publishedAt >= since && n.publishedAt <= until,
    );
    const { catalystsByTicker, catalystsBySector } = buildCatalysts({
      newsRows,
      sectorOf,
      companyIdByTicker,
      nameByTicker,
    });

    const r = runRadar({
      stocks,
      stockBasics,
      catalystsByTicker,
      catalystsBySector,
      floatCapByTicker,
    });

    for (const s of r.sectors) {
      const series = sectorSeries.get(s.sector);
      const si = series?.findIndex((b) => b.day === day) ?? -1;
      if (!series || si < 0) continue;
      const ev = evaluateSignal({ bars: series, index: si, marketBars, marketIndex: dayIdx });
      const key = `行业·${s.signalType}`;
      byType.set(key, [...(byType.get(key) ?? []), ev]);
      total++;
      detail.push(
        `${day} 行业 ${s.sector.padEnd(10)} ${s.signalType.padEnd(10)} ${s.strength.padEnd(6)} ` +
          `1日${pct(ev.vsMarket[1])} 3日${pct(ev.vsMarket[3])} 5日${pct(ev.vsMarket[5])} 10日${pct(ev.vsMarket[10])} 回撤${ev.maxDrawdown?.toFixed(1) ?? "—"}%`,
      );
    }
    for (const st of r.stocks) {
      const bars = byTicker.get(st.ticker);
      const si = bars?.findIndex((b) => b.day === day) ?? -1;
      if (!bars || si < 0) continue;
      const sec = sectorSeries.get(st.sector);
      const ev = evaluateSignal({
        bars,
        index: si,
        marketBars,
        marketIndex: dayIdx,
        sectorBars: sec,
        sectorIndex: sec?.findIndex((b) => b.day === day),
      });
      const key = `个股·${st.signalType}`;
      byType.set(key, [...(byType.get(key) ?? []), ev]);
      total++;
      detail.push(
        `${day} 个股 ${st.name.padEnd(18)} ${st.signalType.padEnd(18)} ${st.strength.padEnd(6)} ` +
          `1日${pct(ev.vsMarket[1])} 3日${pct(ev.vsMarket[3])} 5日${pct(ev.vsMarket[5])} 10日${pct(ev.vsMarket[10])} 回撤${ev.maxDrawdown?.toFixed(1) ?? "—"}%`,
      );
    }
    process.stdout.write(`  ${day}: 行业 ${r.sectors.length} · 个股 ${r.stocks.length}\n`);
  }

  console.log(`\n=== 逐条明细（共 ${total} 条信号）===`);
  for (const line of detail) console.log(line);

  console.log(`\n=== 分类型汇总（超额 = 相对全 A 等权基准）===`);
  console.log(
    `类型                        n   ` +
      WINDOWS.map((w) => `${w}日超额/胜率`.padEnd(18)).join("") +
      `均最大回撤   次日资金反转率`,
  );
  for (const [key, results] of [...byType.entries()].sort()) {
    const b = summarize(key, results);
    const cells = WINDOWS.map((w) => {
      const m = b.meanVsMarket[w];
      const h = b.hitRate[w];
      return m === undefined
        ? "—".padEnd(18)
        : `${(m >= 0 ? "+" : "") + m.toFixed(2)}% / ${((h ?? 0) * 100).toFixed(0)}%`.padEnd(18);
    }).join("");
    console.log(
      `${key.padEnd(24)} ${String(b.n).padStart(4)} ${cells}` +
        `${b.meanMaxDrawdown?.toFixed(2) ?? "—"}%`.padEnd(13) +
        `${b.flowReversalRate !== null ? (b.flowReversalRate * 100).toFixed(0) + "%" : "—"}`,
    );
  }
  // 个股相对**所属行业**的超额单列——逆势走强的立身之本就是这条
  console.log(`\n=== 个股相对所属行业的超额 ===`);
  for (const [key, results] of [...byType.entries()].sort()) {
    if (!key.startsWith("个股")) continue;
    const b = summarize(key, results);
    console.log(
      `${key.padEnd(24)} ${String(b.n).padStart(4)} ` +
        WINDOWS.map((w) => {
          const v = b.meanVsSector[w];
          return (v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`).padEnd(12);
        }).join(""),
    );
  }

  /**
   * 指标落进 `JobRun.metrics`（需求 §12：把效果攒在管道里，不是空等）。
   * 只打**关键几项**：三类信号各自的 10 日超额与胜率、样本量、平均回撤。
   * 逆势走强样本要靠时间积累，`n` 本身就是最该被盯住的指标。
   */
  const metrics: Record<string, number> = { signals: total, days: dates.length };
  for (const [key, results] of byType.entries()) {
    const b = summarize(key, results);
    const slug = key.replace("行业·", "sector_").replace("个股·", "stock_");
    metrics[`${slug}_n`] = b.n;
    const m10 = b.meanVsMarket[10];
    const h10 = b.hitRate[10];
    if (m10 !== undefined) metrics[`${slug}_x10`] = Math.round(m10 * 100) / 100;
    if (h10 !== undefined) metrics[`${slug}_hit10`] = Math.round(h10 * 100);
    if (b.meanMaxDrawdown !== null)
      metrics[`${slug}_dd`] = Math.round(b.meanMaxDrawdown * 100) / 100;
    if (b.flowReversalRate !== null)
      metrics[`${slug}_rev`] = Math.round(b.flowReversalRate * 100);
  }
  console.log(`JSON_RESULT ${JSON.stringify(metrics)}`);

  console.log(
    `\n口径说明：\n` +
      `· 超额 = 信号日之后 N 个交易日的累计收益 − 全 A 等权同期收益（百分点）。\n` +
      `· 行业收益用等权合成指数，与页面上「均涨跌」同一口径。\n` +
      `· 回测**不拉 K 线**，因此不做一字板剔除（线上生成时会做）——这会让回测略微高估。\n` +
      `· 资讯窗口按信号日截断，无前视偏差。\n` +
      `· 样本量小于 20 的桶只能当方向性参考。需求 §12 要求"用滚动历史调阈值、不得按单次行情过拟合"，\n` +
      `  因此本轮**没有**按这份结果改任何阈值。`,
  );
}

main()
  .catch((e) => {
    console.error("[backtest] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
