// 「问解牛」事实层的取数（2026-08-04）。判据与渲染在 `lib/ask-facts`，这里只负责查库。
//
// 三条来源，按可信度排序：
//   ① `newsId`——用户点「问解牛这条」时正在看的那一条，直接给全文摘录（答案通常就在这里）；
//   ② `entityId`——他所在的个股页；
//   ③ 从**问题文本**里认公司——复用入库端那套 `matchEntities`，**不依赖自选**。
//      Alley 没把麒盛科技加进自选，而这恰恰是最常见的情形：看到一条新闻想问问，还没到"记进组合"那步。
//
// 取到实体后按「它自己的事实」取近 90 天资讯（`isOwnFact`，同复盘那条判据），一手优先。

import type { PrismaClient } from "../../generated/prisma";
import {
  matchEntities,
  type EntityDictEntry,
} from "../lib/entity-tagging";
import { isOwnFact } from "../lib/news-subject";
import { isDigestWorthyFiling } from "../lib/market-digest";
import {
  usableExcerpt,
  questionTerms,
  relevanceScore,
  type AskFact,
  type AskFactsInput,
} from "../lib/ask-facts";

/** 事实回看窗口。比复盘长得多——「为什么上半年利润降这么多」的答案可能是三周前的业绩预告。 */
const FACT_WINDOW_DAYS = 120;
const MAX_SUBJECTS = 3;
const MAX_FACTS = 6;
/** 旁证（只是文中提到这家公司）最多带几条——它是补充，不能反客为主。 */
const MAX_MENTIONS = 2;

export type AskFactsResult = AskFactsInput & {
  /** 问题里/页面上认出的公司实体 id（含孪生），供调用方做「记为投资笔记」等后续动作 */
  entityIds: string[];
  /** 一个主体都没认出来——调用方据此告诉用户「我不知道你在问哪家公司」 */
  noSubject: boolean;
};

const EMPTY: AskFactsResult = {
  focus: null,
  facts: [],
  subjects: [],
  entityIds: [],
  noSubject: true,
};

type Db = Pick<PrismaClient, "entity" | "newsItem" | "$queryRawUnsafe">;

/** 一家公司的全部身份：COMPANY 与它发行的 STOCK。资讯可能绑在任一侧，两边都要查。 */
async function expandTwins(db: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.$queryRawUnsafe<{ a: string; b: string }[]>(
    `
    SELECT r."fromId" AS a, r."toId" AS b FROM "EntityRelation" r
    WHERE r.type = 'ISSUES' AND (r."fromId" = ANY($1::text[]) OR r."toId" = ANY($1::text[]))
  `,
    ids,
  );
  const out = new Set(ids);
  for (const r of rows) {
    out.add(r.a);
    out.add(r.b);
  }
  return [...out];
}

export async function loadAskFacts(
  db: Db,
  opts: { question: string; newsId?: string | null; entityId?: string | null },
): Promise<AskFactsResult> {
  const focusRow = opts.newsId
    ? await db.newsItem.findUnique({
        where: { id: opts.newsId },
        select: {
          title: true,
          summary: true,
          content: true,
          tier: true,
          publishedAt: true,
          url: true,
          source: { select: { name: true } },
          entities: {
            select: { entityId: true, entity: { select: { type: true, name: true } } },
          },
        },
      })
    : null;

  // 主体：当前这条资讯绑的公司 → 当前页面的实体 → 从问题文本里认。
  const seed: { id: string; name: string }[] = [];
  for (const e of focusRow?.entities ?? []) {
    if (e.entity.type === "COMPANY" || e.entity.type === "STOCK") {
      seed.push({ id: e.entityId, name: e.entity.name });
    }
  }
  if (opts.entityId) {
    const e = await db.entity.findUnique({
      where: { id: opts.entityId },
      select: { id: true, name: true, type: true },
    });
    if (e && (e.type === "COMPANY" || e.type === "STOCK")) seed.push({ id: e.id, name: e.name });
  }
  if (seed.length === 0) {
    // 词典只取判定需要的那几类：COMPANY/STOCK 是候选，SECTOR 供撞名消歧用。
    const dict = (await db.entity.findMany({
      where: { type: { in: ["COMPANY", "STOCK", "SECTOR"] } },
      select: {
        id: true,
        type: true,
        name: true,
        shortName: true,
        aliases: true,
        ticker: true,
      },
    })) as EntityDictEntry[];
    const byId = new Map(dict.map((d) => [d.id, d]));
    for (const id of matchEntities(opts.question, dict)) {
      const e = byId.get(id);
      if (e && (e.type === "COMPANY" || e.type === "STOCK")) seed.push({ id, name: e.name });
    }
  }

  if (seed.length === 0 && !focusRow) return EMPTY;

  // 同一家公司的孪生实体归一到一个名字上，别在「主体」里出现两遍
  const bare = (n: string) => n.replace(/[（(]\d{4,6}[)）]\s*$/, "").trim();
  const subjects: string[] = [];
  const seedIds: string[] = [];
  for (const s of seed) {
    if (subjects.length >= MAX_SUBJECTS && !subjects.includes(bare(s.name))) continue;
    if (!subjects.includes(bare(s.name))) subjects.push(bare(s.name));
    seedIds.push(s.id);
  }

  const entityIds = await expandTwins(db, seedIds);
  const focus: AskFact | null = focusRow
    ? {
        title: focusRow.title,
        body: focusRow.content ?? focusRow.summary ?? "",
        tier: focusRow.tier,
        sourceName: focusRow.source.name,
        publishedAt: focusRow.publishedAt,
        url: focusRow.url,
        kind: "own",
      }
    : null;

  if (entityIds.length === 0) {
    return { focus, facts: [], subjects, entityIds: [], noSubject: subjects.length === 0 };
  }

  const since = new Date(Date.now() - FACT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.newsItem.findMany({
    where: {
      publishedAt: { gte: since },
      entities: { some: { entityId: { in: entityIds } } },
      ...(opts.newsId ? { id: { not: opts.newsId } } : {}),
    },
    // **按时间取，不按 tier 取**。先前写的是「一手优先」，结果这 60 个名额被一家公司
    // 120 天里的公告全部占满（年报/季报/股东会/法律意见书轻松过 60 条），
    // 媒体那条真正写着原因的（「主要系受美元汇率波动影响」）根本没进候选池。
    // 排序留到 JS 里做——那里才知道哪条有正文、哪条是主体事实。
    orderBy: [{ publishedAt: "desc" }],
    take: 120,
    select: {
      title: true,
      summary: true,
      content: true,
      tier: true,
      publishedAt: true,
      url: true,
      source: { select: { kind: true, name: true } },
      entities: {
        select: {
          entityId: true,
          entity: {
            select: {
              type: true,
              name: true,
              shortName: true,
              aliases: true,
              ticker: true,
            },
          },
        },
      },
    },
  });

  const candidates: AskFact[] = [];
  const seenTitle = new Set<string>();
  for (const r of rows) {
    if (!isDigestWorthyFiling(r.title)) continue;
    // 「绑定到它」≠「关于它」——归因那轮的判据在这里同样适用，
    // 否则又会把「频准激光的事」当成「国盾量子的事实」端给用户。
    const boundEntityCount = r.entities.filter(
      (e) => e.entity.type === "COMPANY" || e.entity.type === "STOCK",
    ).length;
    const mine = r.entities.filter((e) => entityIds.includes(e.entityId));
    if (mine.length === 0) continue;
    const own = isOwnFact(
      { title: r.title, sourceKind: r.source.kind, boundEntityCount },
      mine.map((e) => e.entity),
    );
    const key = r.title.replace(/\s+/g, "");
    if (seenTitle.has(key)) continue;
    seenTitle.add(key);
    candidates.push({
      title: r.title,
      body: r.content ?? r.summary ?? "",
      tier: r.tier,
      sourceName: r.source.name,
      publishedAt: r.publishedAt,
      url: r.url,
      kind: own ? "own" : "mention",
    });
  }

  // **有正文的排前面**。一手公告权威，但 63% 抓不到正文、摘要就是标题本身——
  // 只按「一手优先」排，名额会全被这些空壳标题占满，而真正写着原因的那条
  // （「主要系受美元汇率波动影响，本报告期汇兑损失增加」）反而挤不进去。
  // 排序：有摘录 > 主体事实 > 一手 > 新。
  // 再叠一层**跟问题的相关性**：只按新旧挑，问「为什么利润降这么多」也会挑到
  // 「今日涨幅位列板块第二」这种当天的无关行情稿。相关性用二元组命中数算（零成本、可测）。
  const terms = questionTerms(opts.question);
  const withEx = candidates.map((f) => ({
    f,
    ex: usableExcerpt(f, 160).length > 0,
    rel: relevanceScore(f, terms),
  }));
  withEx.sort(
    (a, b) =>
      Number(b.ex) - Number(a.ex) ||
      b.rel - a.rel ||
      Number(b.f.kind === "own") - Number(a.f.kind === "own") ||
      Number(b.f.tier === "PRIMARY") - Number(a.f.tier === "PRIMARY") ||
      b.f.publishedAt.getTime() - a.f.publishedAt.getTime(),
  );
  // 旁证**留固定名额**：不预留的话，一家公司 120 天的公告能把 6 个位置全占满，
  // 而旁证往往正是唯一带正文的那条。它是补充、不能反客为主，所以也就 2 条封顶。
  const mention = withEx.filter((x) => x.f.kind === "mention").slice(0, MAX_MENTIONS);
  const own = withEx
    .filter((x) => x.f.kind === "own")
    .slice(0, MAX_FACTS - mention.length);
  const facts = [...own, ...mention]
    .sort((a, b) => Number(b.ex) - Number(a.ex) || b.rel - a.rel)
    .map((x) => x.f);

  return { focus, facts, subjects, entityIds, noSubject: subjects.length === 0 };
}
