import { PrismaClient } from "../../generated/prisma";
import {
  generateNeutralInterpretation,
  generatePersonaInterpretation,
  personaName,
  type PersonaKey,
} from "../server/ai";
import { isCompliant, withDisclaimer } from "../lib/compliance";

const db = new PrismaClient();
const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";

type Kind = "NEUTRAL" | PersonaKey;

/**
 * 重新生成某条资讯的 AI 解读（改 prompt 后清缓存用）。复用与 interpret 路由一致的
 * 生成 → 合规过滤 → persona 小注 → 免责 流程，upsert 覆盖旧缓存。
 * 用法：tsx src/scripts/regen-interpretation.ts [newsId] [NEUTRAL,BUFFETT,...]
 * 不传 newsId 时自动挑一条最近的重要资讯。
 */
async function regen(newsId: string, kind: Kind): Promise<string> {
  const news = await db.newsItem.findUnique({
    where: { id: newsId },
    select: {
      title: true,
      summary: true,
      content: true,
      source: { select: { name: true } },
    },
  });
  if (!news) throw new Error(`news ${newsId} not found`);
  const input = {
    title: news.title,
    summary: news.summary,
    content: news.content,
    sourceName: news.source.name,
  };
  const raw =
    kind === "NEUTRAL"
      ? await generateNeutralInterpretation(input)
      : await generatePersonaInterpretation(kind, input);
  const safe = isCompliant(raw)
    ? raw
    : "该资讯的 AI 解读在合规检查中被拦截，暂不展示；请点击原文了解一手信息。";
  const body =
    kind === "NEUTRAL"
      ? safe
      : `【以下为「${personaName(kind)}」投资思维方式演示，非投资建议】\n\n${safe}`;
  const content = withDisclaimer(body);
  await db.interpretation.upsert({
    where: { newsId_kind: { newsId, kind } },
    create: { newsId, kind, content, model: MODEL },
    update: { content, model: MODEL },
  });
  return content;
}

async function main(): Promise<void> {
  const argNews = process.argv[2];
  const argKinds = (process.argv[3]?.split(",") ?? [
    "NEUTRAL",
    "BUFFETT",
  ]) as Kind[];

  let newsId = argNews;
  if (!newsId) {
    const pick = await db.newsItem.findFirst({
      where: { content: { not: null }, importance: { gte: 55 } },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true },
    });
    if (!pick) throw new Error("no candidate news found");
    newsId = pick.id;
    console.log(`picked news ${newsId} — ${pick.title}`);
  }

  for (const kind of argKinds) {
    console.log(`\n===== ${kind} =====`);
    const content = await regen(newsId, kind);
    console.log(content);
    console.log(`\n[contains 一句话看懂]: ${content.includes("一句话看懂")}`);
  }
  console.log(`\nnewsId=${newsId}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
