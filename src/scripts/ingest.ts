import { PrismaClient } from "../../generated/prisma";
import { ingestSource } from "../server/ingest/runner";
import { enrichPdfContent } from "../server/ingest/enrich";
import { checkPriceAlerts } from "../server/price-alert-check";
import { targetsByNeed, hotStockTargets } from "../server/backfill-targets";
import { wallstreetcnAStock } from "../server/ingest/sources/wallstreetcn";
import { eastmoneyAnnouncements } from "../server/ingest/sources/eastmoney-ann";
import { eastmoneyFastNews } from "../server/ingest/sources/eastmoney";
import { jiweiSemi } from "../server/ingest/sources/jiwei";
import { eastmoneyReportsForCodes } from "../server/ingest/sources/eastmoney-report";
import { eastmoneyReportSweep } from "../server/ingest/sources/eastmoney-report-sweep";
import { eastmoneyBillboard } from "../server/ingest/sources/eastmoney-billboard";
import { eastmoneyBlockTrade } from "../server/ingest/sources/eastmoney-blocktrade";
import {
  eastmoneyExecHold,
  eastmoneyShareholderChange,
} from "../server/ingest/sources/eastmoney-holderchange";
import { eastmoneyForecast } from "../server/ingest/sources/eastmoney-forecast";
import { eastmoneyStockNewsForCodes } from "../server/ingest/sources/eastmoney-stocknews";
import { populateSignals, populateSectorSignals } from "../server/ingest/signals";
import { populateDisclosures } from "../server/ingest/disclosure";
import { populateMarketFlow } from "../server/ingest/market-flow";

const db = new PrismaClient();

// 一手公告全市场化：东财全市场公告(带正文)取代原来只查 8 只自选股的巨潮爬虫。
const SOURCES = [
  eastmoneyAnnouncements,
  wallstreetcnAStock,
  eastmoneyFastNews,
  jiweiSemi,
  eastmoneyBillboard, // 龙虎榜结构化事件（覆盖池内个股，收盘后 T+1）
  eastmoneyBlockTrade, // 大宗交易（按股+日聚合，折价=减持信号）
  eastmoneyExecHold, // 董监高增减持（内部人信号）
  eastmoneyShareholderChange, // 股东增减持（大股东层面）
  eastmoneyForecast, // 业绩预告（预增/预减/扭亏，硬 thesis 事件）
  // 全市场研报扫描：按个股定向的那份要 5500 次请求才能覆盖全市场，
  // 实际只在轮转回填里跑，导致近 7 天全库只有 8 篇。这份一次请求 100 条按日期扫。
  eastmoneyReportSweep(7),
];

async function main() {
  // 逐源隔离：任一源抓取/入库失败只记录并跳过，不再中断整轮 ingest。
  for (const s of SOURCES) {
    try {
      const r = await ingestSource(db, s);
      console.log(
        `[${r.source}] fetched=${r.fetched} inserted=${r.inserted} tagged=${r.tagged} screened=${r.screened}`,
      );
    } catch (e) {
      console.error(`[${s.key}] FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 正文兜底：给无正文的 PDF 公告补全文（每轮限量，失败跳过，不影响主流程）。
  try {
    const filled = await enrichPdfContent(db, 40);
    console.log(`[enrich] pdf-content filled=${filled}`);
  } catch (e) {
    console.error(`[enrich] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 到价提醒比价（#3b）：随 ingest cron 每 30 分钟跑一次，触发即一次性置 active=false，提醒中心露出。
  try {
    const r = await checkPriceAlerts(db);
    console.log(`[price-alert] checked=${r.checked} triggered=${r.triggered}`);
  } catch (e) {
    console.error(`[price-alert] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 研报周期刷新（Phase0.4）：研报源无独立 recurring cron——实测全量回填后 24h+ 未更新，
  // 而个股资讯/巨潮各有自己的 backfill cron 在小时级刷新。搭 ingest 每 30 分钟的车，按
  // 「绑定最少优先」(targetsByNeed) 取一小批热门股定向补近 60 天研报，自愈式轮转，界内不拖累主流程。
  try {
    const REPORT_REFRESH_N = 12; // 冷尾自愈（绑定最少优先）
    const REPORT_HOT_N = 10; // 热门股定向（补 targetsByNeed 永不选中热门股、漏采其新研报，run 44）
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 24 * 60 * 60 * 1000);
    const cold = (
      await targetsByNeed(db, {
        market: "A", // 东财研报接口只认 A 股代码
        onSkip: (n) => n > 0 && console.log(`[targets] 跳过 ${n} 只（退市死壳 + 非 A 股）`),
      })
    ).slice(0, REPORT_REFRESH_N);
    const hot = await hotStockTargets(db, REPORT_HOT_N);
    const seen = new Set<string>();
    const targets = [...hot, ...cold].filter(
      (t) => !seen.has(t.code) && seen.add(t.code),
    );
    if (targets.length > 0) {
      const codes = targets.map((t) => t.code);
      const r = await ingestSource(db, eastmoneyReportsForCodes(codes, from, to));
      console.log(
        `[report-refresh] stocks=${codes.length}(hot=${hot.length}) fetched=${r.fetched} inserted=${r.inserted}`,
      );
    }
  } catch (e) {
    console.error(`[report-refresh] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 个股媒体资讯刷新（每股深度，sway：确保每只股都有丰富新闻）：targetsByNeed 取最缺的一批，
  // 搜名字补 20 条媒体资讯，自愈轮转覆盖全部 A股+美股（美股名已是中文，搜索直接命中）。
  try {
    const MEDIA_REFRESH_N = 20; // 冷尾自愈
    const MEDIA_HOT_N = 12; // 热门股定向（同 report，补漏采热门股媒体，run 44）
    const cold = (await targetsByNeed(db)).slice(0, MEDIA_REFRESH_N);
    const hot = await hotStockTargets(db, MEDIA_HOT_N);
    const seen = new Set<string>();
    const targets = [...hot, ...cold].filter(
      (t) => !seen.has(t.code) && seen.add(t.code),
    );
    if (targets.length > 0) {
      const pairs = targets.map((t) => ({ name: t.name, code: t.code }));
      const r = await ingestSource(db, eastmoneyStockNewsForCodes(pairs, 20));
      console.log(
        `[media-refresh] stocks=${pairs.length}(hot=${hot.length}) inserted=${r.inserted}`,
      );
    }
  } catch (e) {
    console.error(`[media-refresh] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 个股结构化信号（Phase1b）：融资余额/一致预期/下次解禁 → EntitySignal（每股每类留最新）。
  // 数据类，不进 NewsItem；展示于个股页信号条。每轮刷新（数据本身日频）。
  try {
    const r = await populateSignals(db);
    console.log(`[signals] margin=${r.margin} consensus=${r.consensus} unlock=${r.unlock}`);
  } catch (e) {
    console.error(`[signals] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 预约披露日：交易所预约披露时间表 → EntitySignal(kind=disclosure)，供催化日历做精确倒计时。
  // 全市场一次扫未来 150 天（约 12 页），比按股拉快几个数量级；本轮没刷到的旧信号会被清理。
  try {
    const r = await populateDisclosures(db);
    console.log(
      `[disclosure] upserted=${r.upserted} scanned=${r.scanned} pruned=${r.pruned}`,
    );
  } catch (e) {
    console.error(`[disclosure] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 全市场涨跌幅 + 主力净流入 → EntitySignal(kind=flow)，供板块轮动 / 个股发现。
  // 全市场 5900 只、每页硬顶 100 条 → ~59 次请求；东财间歇封锁时按页跳过并如实报数，
  // 下一轮 upsert 补齐。绝不放进请求路径。
  try {
    const r = await populateMarketFlow(db);
    console.log(
      `[market-flow] fetched=${r.fetched}/${r.total} upserted=${r.upserted} failedPages=${r.failedPages}`,
    );
  } catch (e) {
    console.error(`[market-flow] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 板块级信号（Phase2·定向）：产业链价格 + 台股月营收 → SECTOR 实体的 EntitySignal。
  try {
    const r = await populateSectorSignals(db);
    console.log(`[sector-signals] commodity=${r.commodity} overseas=${r.overseas}`);
  } catch (e) {
    console.error(`[sector-signals] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
