import { PrismaClient } from "../../generated/prisma";
import { generateMarketDigest, gatherDigestInputs } from "../server/market-digest";
import { generateUserDigests } from "../server/user-digest";
import { buildDigestPrompt } from "../lib/market-digest";

/**
 * 每日 AI 市场复盘（2026-07-28）。A 股收盘后跑一次，产出五段式 + 判断，进 `MarketDigest` 表，
 * 供首屏卡片与每日邮件复用。
 *
 * 用法（**必须带 secret exec**，`OPENROUTER_API_KEY` 只在 secret store）：
 *   secret exec OPENROUTER_API_KEY -- env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" \
 *     SKIP_ENV_VALIDATION=1 npx tsx src/scripts/generate-market-digest.ts
 *
 * 参数：
 *   --force    同日输入指纹未变也重新生成（默认跳过，省 token）
 *   --dry      只打印喂给模型的提示词，不调 AI、不写库
 *   --market-only  只生成市场复盘，跳过个人复盘
 *   --preopen  生成**盘前简报**（覆盖昨收以来的隔夜行情与公告）而不是收盘复盘。
 *              张楚寒 2026-07-31：「昨晚美股的信息没 update 上去」——收盘复盘 15:40 才生成，
 *              早上打开看到的永远是昨天那份，隔夜海外按定义赶不上。
 *
 * 顺序有意义：先市场后个人——个人复盘会把当日市场概况当背景喂进去。
 */
const db = new PrismaClient();

async function main() {
  const force = process.argv.includes("--force");
  const dry = process.argv.includes("--dry");
  const session = process.argv.includes("--preopen") ? "preopen" : "close";

  if (dry) {
    const inputs = await gatherDigestInputs(db, new Date(), session);
    const withFacts = inputs.stocks.filter((s) => s.facts.length > 0).length;
    console.log(
      `[digest] (dry) ${inputs.tradeDate}｜指数 ${inputs.indices.length}｜强势板块 ${inputs.sectors.strong.length}｜弱势 ${inputs.sectors.weak.length}｜个股 ${inputs.stocks.length}(有自有事实 ${withFacts})｜日程 ${inputs.catalysts.length}｜宽度 ${
        inputs.breadth ? `涨${inputs.breadth.up}/跌${inputs.breadth.down}` : "—"
      }`,
    );
    // 六步管线的逐类账本：**每一类都要能回答「池子多少 / 选了几条」**。
    // 兜底/降级不可观测，就会把上游 bug 伪装成「今天这类没事」（上一轮的教训）。
    const poolTotal = inputs.coverage.reduce((a, c) => a + c.pool, 0);
    console.log(
      `[digest] (dry) 事件管线：候选 ${poolTotal} → 入选 ${inputs.events.length} 条`,
    );
    for (const c of inputs.coverage) {
      console.log(
        `    ${c.label.padEnd(5, "　")} 池 ${String(c.pool).padStart(3)} → 选 ${String(c.picked).padStart(2)}${c.gap ? "   ⚠ 有料却一条没选中" : ""}`,
      );
    }
    console.log("—— 提示词 ——");
    console.log(buildDigestPrompt(inputs));
    return;
  }

  const r = await generateMarketDigest(db, { force, session });
  switch (r.status) {
    case "created":
      console.log(`[digest] ✓ ${r.tradeDate} ${session === "preopen" ? "盘前简报" : "收盘复盘"} 已生成`);
      console.log(`  概况：${r.data!.overview}`);
      console.log(
        `  驱动 ${r.data!.drivers.length} 条｜强势板块 ${r.data!.sectors.strong.length}｜弱势 ${r.data!.sectors.weak.length}｜个股 ${r.data!.stocks.length}｜关注点 ${r.data!.watchpoints.length}`,
      );
      console.log(`  判断：${r.data!.judgment}`);
      break;
    case "unchanged":
      console.log(`[digest] ${r.tradeDate} 输入未变，跳过（省 token）`);
      break;
    case "no-data":
      console.log(`[digest] ${r.tradeDate} 无可用输入：${r.reason}`);
      break;
    case "rejected":
      // 合规校验没过不是「小问题」——要吵出来，但不入库
      throw new Error(`[digest] ${r.tradeDate} 模型输出被判废：${r.reason}`);
  }

  // 盘前不跑个人复盘：那份贴的是**当日持仓涨跌**，开盘前根本没有
  if (session === "preopen" || process.argv.includes("--market-only")) return;

  // 个人复盘：每个有自选的用户一份，贴着他自己的持仓写
  const { stats, results } = await generateUserDigests(db, { force });
  console.log(
    `[digest] 个人复盘：用户 ${stats.users}｜新建 ${stats.created}｜未变 ${stats.unchanged}｜判废 ${stats.rejected}｜无持仓 ${stats.skipped}`,
  );
  for (const r of results) {
    if (r.status === "created") console.log(`  · ${r.userId.slice(0, 8)}… ${r.data!.headline}`);
    if (r.status === "rejected") console.error(`  ✗ ${r.userId.slice(0, 8)}… ${r.reason}`);
  }
  if (stats.rejected > 0) {
    throw new Error(`有 ${stats.rejected} 个用户的个人复盘被判废——见上方原因，不要放宽校验`);
  }
}

main()
  .catch((e) => {
    console.error("[digest] 失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
