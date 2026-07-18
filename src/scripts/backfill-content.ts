import { PrismaClient } from "../../generated/prisma";
import { enrichPdfContent } from "../server/ingest/enrich";

const db = new PrismaClient();

/** 一次性回填：给历史无正文的 PDF 公告补全文，直到无可补或达批次上限。 */
async function main() {
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const n = await enrichPdfContent(db, 20);
    total += n;
    console.log(`batch ${i + 1}: filled=${n} (total=${total})`);
    if (n === 0) break;
  }
  console.log(`backfill-content 完成：共补正文 ${total} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
