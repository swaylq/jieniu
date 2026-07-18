// 手动把股票加进 agent（张楚寒常用：现场把某人的持仓加进来）。
// 用法：... npx tsx src/scripts/add-stocks.ts 永新光学:603297 新化股份 国盾量子:688027
//   - 传 name:code 直接用；只传 name 则用东财 suggest 解析代码。
// 每只：建 COMPANY+STOCK+ISSUES（幂等）→ 顺手拉巨潮公告，页面立刻有料。
// 建实体 + 解析代码逻辑与「自助加股」路由共用 src/server/stocks.ts。

import { PrismaClient } from "../../generated/prisma";
import { ensureStockEntities, resolveCodeByName } from "../server/stocks";
import { ingestSource } from "../server/ingest/runner";
import { cninfoForCodes } from "../server/ingest/sources/cninfo";

const db = new PrismaClient();

async function main() {
  const specs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (specs.length === 0) {
    console.log("用法: add-stocks.ts 名称[:代码] ...");
    return;
  }
  const codes: string[] = [];
  for (const spec of specs) {
    const [name, given] = spec.split(":");
    const code = given ?? (await resolveCodeByName(name!));
    if (!code) {
      console.log(`✗ ${name}：解析代码失败，跳过`);
      continue;
    }
    await ensureStockEntities(db, name!, code);
    codes.push(code);
    console.log(`✓ ${name}(${code}) 已加入`);
  }
  if (codes.length > 0) {
    const r = await ingestSource(db, cninfoForCodes(codes));
    console.log(`\n公告回填: fetched=${r.fetched} inserted=${r.inserted} tagged=${r.tagged}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
