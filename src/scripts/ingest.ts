import { PrismaClient } from "../../generated/prisma";
import { ingestSource } from "../server/ingest/runner";
import { enrichPdfContent } from "../server/ingest/enrich";
import { checkPriceAlerts } from "../server/price-alert-check";
import { wallstreetcnAStock } from "../server/ingest/sources/wallstreetcn";
import { eastmoneyAnnouncements } from "../server/ingest/sources/eastmoney-ann";
import { eastmoneyFastNews } from "../server/ingest/sources/eastmoney";
import { jiweiSemi } from "../server/ingest/sources/jiwei";

const db = new PrismaClient();

// 一手公告全市场化：东财全市场公告(带正文)取代原来只查 8 只自选股的巨潮爬虫。
const SOURCES = [
  eastmoneyAnnouncements,
  wallstreetcnAStock,
  eastmoneyFastNews,
  jiweiSemi,
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
