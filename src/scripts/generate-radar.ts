// 机会雷达信号生成。
// 用法：NODE_ENV=development npx tsx src/scripts/generate-radar.ts [--ai] [--asOf=2026-07-29]
//
// --ai   用强模型润色六段人话（缺 OPENROUTER_API_KEY 时自动退回确定性底稿，不中断）
// --asOf 回到某个交易日重新生成（回测/复核用）
// --with-commodity 强制取商品行情（**只用于验证渲染链路**：历史日会拿到今天的价格，
//                  不能用于回测或效果统计）

import { PrismaClient } from "../../generated/prisma";
import { generateRadar } from "../server/radar/generate";

const db = new PrismaClient();

async function main() {
  const withAI = process.argv.includes("--ai");
  const asOfArg = process.argv.find((a) => a.startsWith("--asOf="));
  const asOf = asOfArg ? asOfArg.split("=")[1] : undefined;

  const t0 = Date.now();
  const withCommodity = process.argv.includes("--with-commodity")
    ? true
    : undefined;
  if (withCommodity && asOf)
    console.warn(
      "[radar] ⚠ --with-commodity + --asOf：商品价格是当下快照，这批信号带的是今天的价格，只可用于渲染验证",
    );
  const r = await generateRadar(db, { withAI, asOf, withCommodity });
  const d = r.diagnostics;

  console.log(
    `[radar] 交易日 ${r.tradeDate} · 行业 ${r.sectors} · 个股 ${r.stocks} · 追高风险 ${r.risks} · ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  console.log(
    `[radar] 生命周期：失效 ${r.expired} · 升级 ${r.upgraded}；AI 润色 ${r.aiPolished} 失败 ${r.aiFailed}；一字板剔除 ${r.oneWordFiltered.join(",") || "无"}`,
  );
  console.log(
    `[radar] 商品价格：取到 ${r.commodityQuotes} 个品种，够催化门槛 ${r.commodityMaterial} 条；清理当日陈旧信号 ${r.staleRemoved} 条`,
  );
  // 「今天没有信号」是合法输出，但必须能区分"确实没有"和"数据没到"——所以诊断照打
  console.log(
    `[radar] 诊断：板块 ${d.sectorsEvaluated} 个（EARLY ${d.sectorsPassedEarly} / CONFIRMED ${d.sectorsPassedConfirmed} / 分数不够 ${d.sectorsBelowScore} / 拥挤 ${d.sectorsCrowded}）；` +
      `个股候选 ${d.stockCandidates}（基础过滤掉 ${d.stocksFilteredOut} / 分数不够 ${d.stocksBelowScore} / 逆势通过 ${d.relativeStrengthPassed}）`,
  );
  console.log(
    `[radar] 全 A 基准：3日 ${d.benchmark.ret3?.toFixed(2)}% · 5日 ${d.benchmark.ret5?.toFixed(2)}% · 20日 ${d.benchmark.ret20?.toFixed(2)}% · 上涨占比 ${((d.benchmark.breadthUpShare ?? 0) * 100).toFixed(0)}%`,
  );
  console.log(
    `JSON_RESULT ${JSON.stringify({ tradeDate: r.tradeDate, sectors: r.sectors, stocks: r.stocks, risks: r.risks, expired: r.expired, upgraded: r.upgraded, aiFailed: r.aiFailed })}`,
  );
}

main()
  .catch((e) => {
    console.error("[radar] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
