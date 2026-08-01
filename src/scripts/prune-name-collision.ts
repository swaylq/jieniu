// 存量清理（2026-08-02 复盘）：公司名恰好就是板块名而产生的误绑。
//
// 沈阳新松的证券简称是「机器人」，于是每条讲机器人行业的稿子都绑到了它——近 7 天 532 条
// STOCK 绑定里，标题把它当一家公司来提的是 0 条。入库端已加消歧（见 lib/entity-tagging
// 的 needsDisambiguation：撞板块名的公司/股票不认裸名，要代码或「简称:」开头的公告体裁），
// 本脚本用**同一套匹配逻辑**复算历史绑定，匹配不上的剪掉。
//
// 只动撞名实体的 COMPANY / STOCK 绑定；板块那份一条不碰（板块本来就该收这些行业稿）。
// 幂等：再跑一次不会多剪。默认 dry-run。
// 用法：DATABASE_URL=... SKIP_ENV_VALIDATION=1 npx tsx src/scripts/prune-name-collision.ts [--apply]

import { PrismaClient } from "../../generated/prisma";
import {
  matchEntities,
  needsDisambiguation,
  type EntityDictEntry,
} from "../lib/entity-tagging";

const db = new PrismaClient();

function bare(name: string): string {
  return name.replace(/[（(][^（()）]*[)）]\s*$/, "").trim();
}

async function main() {
  const apply = process.argv.includes("--apply");

  const dict = (await db.entity.findMany({
    select: {
      id: true,
      type: true,
      name: true,
      shortName: true,
      aliases: true,
      ticker: true,
    },
  })) as EntityDictEntry[];

  const sectorNames = new Set(
    dict.filter((e) => e.type === "SECTOR").map((e) => bare(e.name)),
  );
  const collided = dict.filter((e) => needsDisambiguation(e, sectorNames));
  console.log(
    `撞板块名的 COMPANY/STOCK：${collided.length} 个 —— ${collided.map((c) => `${c.name}(${c.type})`).join("、") || "无"}`,
  );
  if (collided.length === 0) return;

  // 复算只需要「该实体 + 全部板块」这个最小字典：消歧判定依赖板块名集合，
  // 带上全量 11k 实体既慢又会引入无关实体的匹配结果。
  const sectors = dict.filter((e) => e.type === "SECTOR");

  let scanned = 0;
  let toPrune = 0;
  for (const c of collided) {
    const links = await db.newsEntity.findMany({
      where: { entityId: c.id },
      select: { newsId: true, entityId: true, news: { select: { title: true } } },
    });
    const doomed: { newsId: string; title: string }[] = [];
    for (const l of links) {
      scanned++;
      if (!matchEntities(l.news.title, [c, ...sectors]).includes(c.id)) {
        doomed.push({ newsId: l.newsId, title: l.news.title });
      }
    }
    toPrune += doomed.length;
    console.log(
      `  ${c.name}(${c.type}): 绑定 ${links.length} 条 → 剪掉 ${doomed.length} 条，保留 ${links.length - doomed.length} 条`,
    );
    for (const d of doomed.slice(0, 3)) console.log(`     剪: ${d.title.slice(0, 40)}`);
    if (apply && doomed.length > 0) {
      // 分批删，别一次塞几千个 id
      for (let i = 0; i < doomed.length; i += 500) {
        const batch = doomed.slice(i, i + 500).map((d) => d.newsId);
        await db.newsEntity.deleteMany({
          where: { entityId: c.id, newsId: { in: batch } },
        });
      }
    }
  }
  console.log(
    `\n扫描 ${scanned} 条绑定 → ${apply ? `已剪掉 ${toPrune} 条` : `应剪 ${toPrune} 条（未加 --apply，仅报告）`}`,
  );
  await db.$disconnect();
}

void main();
