// 事件摘要补齐（一次生成、入库复用）——只给**最新 + 重磅 + 属于有投资逻辑公司**的少量资讯做。
//
// 为什么是这个口径（实测近 24h 体量，成本差 80 倍）：
//   重磅 + 任意覆盖公司        433 条/天  ← 太贵
//   重磅 + 有 thesis 的公司     66 条/天  ← 采用：正是解牛有判断的公司，摘要能跟逻辑挂钩
//   重磅 + 有人自选的公司        5 条/天  ← 太窄，新用户看不到
//
// ⚠️ AI 必须 deepseek（anthropic/openai 在大陆 403）。用法：
//   secret exec OPENROUTER_API_KEY -- env DATABASE_URL=... SKIP_ENV_VALIDATION=1 \
//     OPENROUTER_MODEL="deepseek/deepseek-chat" npx tsx src/scripts/brief-recent.ts [--limit=40] [--hours=24]

import { PrismaClient } from "../../generated/prisma";
import { generateEventBrief } from "~/server/ai";
import { IMPORTANT_THRESHOLD } from "../lib/importance";

const db = new PrismaClient();

function argNum(flag: string, dflt: number): number {
  const a = process.argv.find((x) => x.startsWith(`--${flag}=`));
  const n = a ? Number(a.slice(flag.length + 3)) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

async function main() {
  const limit = argNum("limit", 40);
  const hours = argNum("hours", 24);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // 有投资逻辑的公司 = 解牛真有判断的那批
  const withThesis = await db.thesis.findMany({ select: { entityId: true } });
  const ids = withThesis.map((t) => t.entityId);
  if (ids.length === 0) {
    console.log("暂无任何 thesis，跳过。");
    return;
  }

  const targets = await db.newsItem.findMany({
    where: {
      createdAt: { gte: since },
      importance: { gte: IMPORTANT_THRESHOLD },
      brief: null, // 一次生成：已有摘要的不再花钱
      entities: { some: { entityId: { in: ids } } },
    },
    orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      title: true,
      summary: true,
      content: true,
      source: { select: { name: true } },
    },
  });

  console.log(
    `近 ${hours}h 内「重磅 + 属于有投资逻辑公司 + 尚无摘要」的资讯 → 本轮生成 ${targets.length} 条（上限 ${limit}）`,
  );
  if (targets.length === 0) return;

  let ok = 0;
  for (const n of targets) {
    try {
      const brief = (
        await generateEventBrief({
          title: n.title,
          summary: n.summary,
          content: n.content,
          sourceName: n.source.name,
        })
      )
        .replace(/\s+/g, " ")
        .replace(/^["“」」]|["”」]$/g, "")
        .trim();
      // 收尾：模型偶尔会超长被 max_tokens 截断成半句（「…销售激增，」）。
      // 半句比没有更糟——回退到最后一个完整句读点；退不回去就整条丢弃，不入库半成品。
      const tidy = /[。！？]$/.test(brief)
        ? brief
        : (() => {
            const cut = Math.max(
              brief.lastIndexOf("。"),
              brief.lastIndexOf("！"),
              brief.lastIndexOf("？"),
            );
            return cut > 10 ? brief.slice(0, cut + 1) : "";
          })();
      if (!tidy) throw new Error("摘要被截断且无法回退到完整句，跳过");
      const brief2 = tidy;
      if (!brief2) throw new Error("空摘要");
      await db.newsItem.update({
        where: { id: n.id },
        data: { brief: brief2 },
      });
      ok++;
      console.log(`✓ ${n.title.slice(0, 26)} → ${brief2.slice(0, 46)}`);
    } catch (err) {
      console.error(`✗ ${n.title.slice(0, 26)}:`, (err as Error).message);
    }
  }
  console.log(`\n完成 ${ok}/${targets.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
