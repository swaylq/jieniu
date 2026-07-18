// 存量清理（产品质量循环 2026-07-15 run8）：官方公告源(official-filing=东财公告/巨潮)按市场全量抓，
// 把成千上万条**非覆盖小盘股**的章程/股东会/董事会/业绩预告公告灌进 DB 和首页「最新」流——
// 出了本产品「只覆盖最热门板块核心标的」的范围。官方公告是公司专属体裁：若绑不到任何覆盖的
// COMPANY/STOCK 即删。
//
// ⚠ 关键：用**当前词典重标**判定（非 stored 绑定）。覆盖面从 103→508 家逐步扩容，早期入库的
// 覆盖公司公告当时没绑上（陈旧漏绑）；这些重标后能绑到 COMPANY/STOCK，须**保护不删**（留待后续
// 统一重标救回，如 华勤技术收购/长城汽车购回/白云山基药目录）。只删重标后仍无 COMPANY/STOCK 的真非覆盖项。
//
// runner.ts 已在入库端同步 gate。用法：... npx tsx src/scripts/prune-uncovered-filings.ts [--apply]

import { PrismaClient } from "../../generated/prisma";
import { matchEntities, type EntityDictEntry } from "../lib/entity-tagging";
import { isIntermediaryName } from "../lib/relevance";

const db = new PrismaClient();

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
  const dictById = new Map(dict.map((d) => [d.id, d]));

  // 覆盖标的名字集（COMPANY/STOCK 的 name+shortName）——东财公告主体=标题「公司名:」前缀，用它判主体是否覆盖。
  const coveredNames = new Set(
    dict
      .filter((d) => d.type === "COMPANY" || d.type === "STOCK")
      .flatMap((d) => [d.name, d.shortName].filter(Boolean) as string[]),
  );
  // 金融中介实体集（券商板块成员 ∪ 名字含证券/事务所/评估）——正文提到的券商不算公告主体。
  const brokerSector = await db.entity.findFirst({
    where: { type: "SECTOR", name: "券商" },
    select: { id: true },
  });
  const brokerMemberIds = brokerSector
    ? (
        await db.entityRelation.findMany({
          where: { toId: brokerSector.id, type: "BELONGS_TO" },
          select: { fromId: true },
        })
      ).map((r) => r.fromId)
    : [];
  const intermediaryIds = new Set<string>([
    ...brokerMemberIds,
    ...dict.filter((d) => d.type === "COMPANY" && isIntermediaryName(d.name)).map((d) => d.id),
  ]);
  // 公告主体是否覆盖：①「公司名:」前缀恰为覆盖标的，或②正文重标出覆盖的**非中介** COMPANY/STOCK（cninfo 无前缀时兜底）。
  const subjectCovered = (title: string, summary: string | null): boolean => {
    const prefix = title.split(/[:：]/)[0]?.trim() ?? "";
    if (prefix && coveredNames.has(prefix)) return true;
    const ids = matchEntities(`${title}\n${summary ?? ""}`, dict);
    return ids.some((id) => {
      const e = dictById.get(id);
      return e && (e.type === "COMPANY" || e.type === "STOCK") && !intermediaryIds.has(id);
    });
  };

  const sources = await db.source.findMany({
    where: { kind: "official-filing" },
    select: { id: true },
  });
  const sourceIds = sources.map((s) => s.id);
  if (sourceIds.length === 0) {
    console.log("无 official-filing 源，跳过。");
    return;
  }

  const total = await db.newsItem.count({ where: { sourceId: { in: sourceIds } } });

  // stored 层面无 COMPANY/STOCK 绑定的官方公告——候选（含真非覆盖 + 陈旧漏绑的覆盖公司公告）
  const candidates = await db.newsItem.findMany({
    where: {
      sourceId: { in: sourceIds },
      entities: { none: { entity: { type: { in: ["COMPANY", "STOCK"] } } } },
    },
    select: { id: true, title: true, summary: true, source: { select: { key: true } } },
  });

  const toDelete: string[] = [];
  let staleRescue = 0; // 主体是覆盖标的、只是陈旧漏绑 → 保护不删
  const delSample: string[] = [];
  const rescueSample: string[] = [];
  for (const n of candidates) {
    if (subjectCovered(n.title, n.summary)) {
      staleRescue++;
      if (rescueSample.length < 6) rescueSample.push(n.title.slice(0, 34));
    } else {
      toDelete.push(n.id);
      if (delSample.length < 12) delSample.push(`[${n.source?.key}] ${n.title.slice(0, 32)}`);
    }
  }

  console.log(`官方公告总数 ${total} 条`);
  console.log(`  stored 无 COMPANY/STOCK 绑定的候选 ${candidates.length} 条`);
  console.log(`  → 非覆盖主体(应删) ${toDelete.length} 条`);
  console.log(`  → 覆盖主体·陈旧漏绑(保护不删) ${staleRescue} 条`);
  console.log("  删除样本：");
  for (const s of delSample) console.log("   ·", s);
  console.log("  保护样本(覆盖主体、后续统一重标救回)：");
  for (const s of rescueSample) console.log("   ·", s);

  if (toDelete.length === 0) return;
  if (!apply) {
    console.log("\n(dry-run — 加 --apply 才删。级联清 NewsEntity/解读/收藏。)");
    return;
  }

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 500) {
    const r = await db.newsItem.deleteMany({
      where: { id: { in: toDelete.slice(i, i + 500) } },
    });
    deleted += r.count;
  }
  console.log(`\n已删 ${deleted} 条非覆盖标的官方公告（首页「最新」聚焦覆盖标的）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
