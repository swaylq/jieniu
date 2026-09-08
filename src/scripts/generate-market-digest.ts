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
  // 判废**不放宽校验**（不入库、原因照打），但也不该由它决定整个 job 的成败。
  //
  // 2026-09-07 实测这条 throw 的真实代价：`cmsaeery` 那份模型输出被截断（JSON 断在
  // `{"n`）→ 判废 1 → 这里 throw → 进程 exit 1 → `daily-digest` 的第二步
  // 「生成提醒并发信」被调度器连坐跳过 → 当天那封每日邮件一封没发。而那封信的骨架是
  // 市场复盘、**每天都发**（见 alert-mailer.ts），跟这一个用户毫无关系。
  // 近 21 天 daily-digest 失败 4 次（08-20 / 08-28 / 09-05 / 09-07），全是这个形状。
  // 8-22 就把这条连坐写进了 user-audit.ts 的注释，写下来不等于修好——今天还在踩。
  //
  // 而且这多半是**瞬时**的：09-07 原样重跑一次，19 个用户全过、判废 0，
  // 那份被截断的输出一次重试就好了。
  //
  // 所以退出码只反映「这一趟是不是整体坏了」：
  //   一个都没生成出来（模型挂了 / 提示词坏了 / 余额没了）→ 非 0，后面的步骤不该跑；
  //   多数人拿到了、个别人判废 → 打一行 ✗ 然后 exit 0，别让 18 个人替 1 个人受过。
  // 少数判废不会因此变得无人知晓：user-audit.ts 的 ④ 会点名「谁今天没有复盘」。
  if (stats.rejected > 0 && stats.created === 0) {
    throw new Error(`${stats.rejected} 个用户的个人复盘全部被判废、一份都没生成——见上方原因，不要放宽校验`);
  }
  if (stats.rejected > 0) {
    console.error(
      `[digest] ✗ ${stats.rejected}/${stats.users} 个用户的个人复盘被判废（其余 ${stats.created} 份已生成）——` +
        `见上方原因，不要放宽校验。这些用户今天首页没有个人复盘`,
    );
  }
}

main()
  .catch((e) => {
    console.error("[digest] 失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
