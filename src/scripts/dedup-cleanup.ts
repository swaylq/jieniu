import { PrismaClient, type SourceTier } from "../../generated/prisma";
import { normalizeTitle, isLowValueTitle } from "../lib/dedupe";

const db = new PrismaClient();

const TIER_RANK: Record<SourceTier, number> = {
  PRIMARY: 3,
  MEDIA: 2,
  DERIVED: 1,
};

/**
 * 一次性清理：① 删除无价值公告；② 跨源重复的资讯只保留一条
 * （tier 最高、其次最早）。NewsEntity/Interpretation/Bookmark 均级联删除。
 */
async function main() {
  const items = await db.newsItem.findMany({
    select: { id: true, title: true, tier: true, createdAt: true },
  });

  const toDelete = new Set<string>();
  for (const it of items) {
    if (isLowValueTitle(it.title)) toDelete.add(it.id);
  }

  const groups = new Map<string, typeof items>();
  for (const it of items) {
    if (toDelete.has(it.id)) continue;
    const k = normalizeTitle(it.title);
    if (!k) continue;
    let g = groups.get(k);
    if (!g) {
      g = [];
      groups.set(k, g);
    }
    g.push(it);
  }
  const mergeInto = new Map<string, string>(); // 被删的跨源重复 → 保留项 id
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort(
      (a, b) =>
        TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const survivorId = g[0]!.id;
    for (const it of g.slice(1)) {
      toDelete.add(it.id);
      mergeInto.set(it.id, survivorId);
    }
  }

  const ids = [...toDelete];
  if (ids.length > 0) {
    // 跨源重复被删前，把挂在其上的书签（用户数据）与解读（付费 AI 内容）转移到保留项，
    // 别让级联删除静默丢失。派生数据（NewsEntity/ThesisSignal）可由 retag/classify 重算，不迁移。
    const losers = [...mergeInto.keys()];
    const [loserBookmarks, loserInterps] = await Promise.all([
      db.bookmark.findMany({ where: { newsId: { in: losers } } }),
      db.interpretation.findMany({ where: { newsId: { in: losers } } }),
    ]);
    await db.$transaction([
      db.bookmark.createMany({
        data: loserBookmarks.map((b) => ({
          userId: b.userId,
          newsId: mergeInto.get(b.newsId)!,
          createdAt: b.createdAt,
        })),
        skipDuplicates: true,
      }),
      db.interpretation.createMany({
        data: loserInterps.map((i) => ({
          newsId: mergeInto.get(i.newsId)!,
          kind: i.kind,
          content: i.content,
          model: i.model,
          createdAt: i.createdAt,
        })),
        skipDuplicates: true,
      }),
      db.newsItem.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }
  console.log(
    `dedup-cleanup: 删除 ${ids.length} 条（无价值+跨源重复），剩 ${items.length - ids.length}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
