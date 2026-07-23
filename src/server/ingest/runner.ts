import type { PrismaClient } from "../../../generated/prisma";
import type { SourceDef } from "./types";
import { newsHash } from "./hash";
import {
  matchEntities,
  resolveHints,
  hasCoveredEntity,
  type EntityDictEntry,
} from "../../lib/entity-tagging";
import { scoreImportance, detectEventType } from "../../lib/importance";
import {
  normalizeTitle,
  isLowValueTitle,
  crossSourceKey,
  historicalKey,
  isCrossSourceRepeat,
  type PriorFiling,
} from "../../lib/dedupe";
import { cleanText, cleanInline, screenQuality } from "../../lib/quality";
import {
  isRoundupNews,
  isEtfMarketing,
  isIntermediaryRole,
  isIntermediaryName,
  isInstitutionOpinionAboutOthers,
  isReportPublisherOf,
  isBoilerplateFiling,
  isForeignMarketNoise,
  isForeignFinancialNoise,
} from "../../lib/relevance";

export type IngestResult = {
  source: string;
  fetched: number;
  inserted: number;
  tagged: number;
  screened: number;
};

/**
 * 历史回填模式。
 *
 * 实时抓取的判重集合按 `createdAt >= 近 7 天` 载入——这对每 30 分钟跑一次的 ingest 是对的，
 * 但回填一年会踩两个坑：
 *  ① 早已入库、createdAt 超过 7 天的旧条目看不见（实测已有 3,360 条巨潮 + 600 条东财公告
 *    落在窗口外），同一份公告会在东财/巨潮两个源下各存一份；
 *  ② 反过来，若把窗口简单拉长到一年，「回购进展公告」这类一年重复十几次、标题一字不差的
 *    公告又会被按标题误并成一条。
 * 所以回填模式改为：**按目标实体 + 发布时间区间**载入判重集合，判重键带上发布日
 * （见 dedupe.historicalKey）。
 */
export type BackfillScope = {
  entityIds: string[];
  publishedFrom: Date;
  publishedTo: Date;
};

export type IngestOptions = {
  backfill?: BackfillScope;
};

/**
 * 抓一个源 → 归一化 → hash 去重 → 词典标注实体 → 重要性打分 → 入库。
 * db 由调用方注入（脚本用独立 PrismaClient，路由/cron 用 ctx.db）。
 */
export async function ingestSource(
  db: PrismaClient,
  def: SourceDef,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const source = await db.source.upsert({
    where: { key: def.key },
    create: { key: def.key, name: def.name, tier: def.tier, kind: def.kind },
    update: { name: def.name, tier: def.tier, kind: def.kind },
  });

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

  // 金融中介实体集（券商板块成员 ∪ 名字含证券/事务所/评估）——用于剪掉「保荐机构/核查方」错绑。
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
    ...dict
      .filter((d) => d.type === "COMPANY" && isIntermediaryName(d.name))
      .map((d) => d.id),
  ]);
  const dictById = new Map(dict.map((d) => [d.id, d]));

  const raws = await def.fetch(dict);

  // 跨源去重 + 无价值公告过滤：载入近 7 天标题（归一）比对，避免同一新闻多源刷屏。
  // 回填模式则改按「目标实体 + 发布区间」载入（理由见 BackfillScope）。
  const bf = opts.backfill;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await db.newsItem.findMany({
    where: bf
      ? {
          publishedAt: { gte: bf.publishedFrom, lte: bf.publishedTo },
          entities: { some: { entityId: { in: bf.entityIds } } },
        }
      : { createdAt: { gte: since } },
    select: {
      title: true,
      publishedAt: true,
      source: { select: { key: true } },
      entities: { select: { entityId: true } },
    },
  });
  // 回填时**不**做整标题判重：一年里同名的周期性公告（回购进展/重大合同）是不同的真实事件。
  const seenTitles = bf
    ? new Set<string>()
    : new Set(recent.map((n) => normalizeTitle(n.title)));
  // 跨源判重（run7）：同一公告东财带「公司名:」前缀、巨潮不带，整标题判重漏掉；
  // 按 (绑定实体集 + 去前缀正文标题) 再判一次，避免个股「公告」页/自选早报同一公告出现两条。
  const seenCross = new Set(
    recent
      .filter((n) => n.entities.length > 0)
      .map((n) => {
        const ids = n.entities.map((e) => e.entityId);
        return bf
          ? historicalKey(n.title, ids, n.publishedAt)
          : crossSourceKey(n.title, ids);
      }),
  );
  // 回填还需按「不看日期」的 key 再索引一次：两个源对同一份公告的日期常差 1 天，
  // 带日期的 key 判不到一起（实测漏判 697 组）。跨源且日期相差 ≤2 天 → 判为同一份。
  const priorsByTitle = new Map<string, PriorFiling[]>();
  if (bf) {
    for (const n of recent) {
      if (n.entities.length === 0) continue;
      const k = crossSourceKey(
        n.title,
        n.entities.map((e) => e.entityId),
      );
      const arr = priorsByTitle.get(k);
      const entry: PriorFiling = {
        publishedAt: n.publishedAt,
        sourceKey: n.source.key,
      };
      if (arr) arr.push(entry);
      else priorsByTitle.set(k, [entry]);
    }
  }

  let inserted = 0;
  let tagged = 0;
  let screened = 0;
  for (const r of raws) {
    // 质量筛查：先清洗(去 HTML/实体/多余空白)，再剔除垃圾(空/超短标题、广告引流、乱码)。
    const title = cleanInline(r.title);
    const summary = cleanInline(r.summary);
    const content = r.content ? cleanText(r.content) : null;
    const verdict = screenQuality({ title, summary, content });
    if (!verdict.ok) {
      screened++;
      continue;
    }

    if (isLowValueTitle(title)) continue;
    if (isEtfMarketing(title)) continue; // ETF 营销 blurb（非公司资讯）——垃圾，不入库
    if (isBoilerplateFiling(title)) continue; // 纯治理/文件模板公告（章程/鉴证/H股月报表…）——噪声，不入库
    if (isForeignMarketNoise(title)) continue; // 海外市场盘面碎讯（美股/纳指/日韩…）——非 A 股，不入库
    const norm = normalizeTitle(title);
    if (norm && seenTitles.has(norm)) continue; // 已有同标题（可能来自他源），跳过

    const hash = newsHash(def.key, r.externalId ?? r.url, title);
    if (await db.newsItem.findUnique({ where: { hash } })) continue;

    // 官方公告(official-filing=东财公告/巨潮)按市场全量抓，非覆盖小盘股的章程/股东会/董事会/业绩预告
    // 会刷屏首页「最新」。公告是公司专属体裁，主体=源给的权威归属(entityHints: 股票简称+代码)。
    // 主体不在覆盖范围即丢——正文顺带提到的券商(保荐)/被收购方不算主体，避免非覆盖公司借券商绑定混入。
    // 媒体源(macro/policy/板块)无此限。放在 matchEntities 前，省掉全量非覆盖公告的打标开销。
    if (def.kind === "official-filing") {
      const subjectIds = resolveHints(r.entityHints, dict);
      if (!hasCoveredEntity(subjectIds, dictById)) {
        screened++;
        continue;
      }
    }

    // 只按 标题+摘要 打标：正文里顺带提到的公司/板块词多不代表这条"关于"它，纳入会大量误配。
    // subjectOnly 体裁（研报）跳过文本匹配：主体由源权威给出，标题里的行业词不是它的主体。
    const textIds = def.subjectOnly
      ? []
      : matchEntities(`${title}\n${summary}`, dict);
    let entityIds = Array.from(
      new Set([...textIds, ...resolveHints(r.entityHints, dict)]),
    );
    // 综述/榜单/大盘类（收评、涨停潮、基金二季报…）：标题/摘要顺带罗列多只个股，非"关于"某只。
    // 只保留板块归属，不绑到 COMPANY/STOCK/PERSON——否则污染「你的自选股」早报与个股页。
    if (isRoundupNews(title, entityIds.length)) {
      const sectorIds = new Set(
        dict.filter((d) => d.type === "SECTOR").map((d) => d.id),
      );
      entityIds = entityIds.filter((id) => sectorIds.has(id));
    }
    // 保荐/核查类公告：券商是中介、被保荐公司才是主体——剪掉券商绑定（保留被保荐公司）。
    if (isIntermediaryRole(title)) {
      entityIds = entityIds.filter((id) => !intermediaryIds.has(id));
    }
    // 研报观点体裁「机构：看好某行业」：观点主体是被点评行业/标的，剪掉发声机构自身绑定
    // （只对券商/中介生效，公司自身「XX公司：声明」不受影响；被点评板块/标的绑定保留）。
    entityIds = entityIds.filter((id) => {
      if (!intermediaryIds.has(id)) return true;
      const e = dictById.get(id);
      if (!e) return true;
      // 「机构名：观点」前缀 与 研报的「（发布机构）」后缀，都是发声者而非主体，剪掉其自身绑定。
      return (
        !isInstitutionOpinionAboutOthers(title, e.name) &&
        !isReportPublisherOf(title, e)
      );
    });
    // 海外投行/银行谈自家业绩/大宗/海外央行、且不涉任何 A 股实体的碎讯——非 A 股噪声，不入库。
    // 「高盛恢复跟踪宁德时代A股」这类有 A 股绑定的会命中 entityIds>0 而保留。
    if (entityIds.length === 0 && isForeignFinancialNoise(title)) continue;

    // 跨源重复：同公司同公告，东财记「公司名:标题」、巨潮记「标题」——按(实体集+去前缀标题)再判一次。
    const ckey =
      entityIds.length === 0
        ? null
        : bf
          ? historicalKey(title, entityIds, r.publishedAt)
          : crossSourceKey(title, entityIds);
    if (ckey && seenCross.has(ckey)) continue;
    // 跨源同一份公告（日期差 1–2 天）：只并跨源，同源同名不动（可能是两件真事）。
    if (bf && entityIds.length > 0) {
      const loose = crossSourceKey(title, entityIds);
      const priors = priorsByTitle.get(loose);
      if (priors && isCrossSourceRepeat(priors, r.publishedAt, def.key)) continue;
    }
    // 所有源统一识别事件类型：源已显式给出则用之，否则从 标题+摘要+正文 检测。
    // 修复：此前仅 cninfo 设 eventType，媒体源恒为 30 分、永远进不了「重大动态」/通知。
    const eventType =
      r.eventType ?? detectEventType(`${title}\n${summary}\n${content ?? ""}`);
    const importance = scoreImportance({ tier: def.tier, eventType });

    await db.newsItem.create({
      data: {
        sourceId: source.id,
        tier: def.tier,
        title,
        url: r.url,
        publishedAt: r.publishedAt,
        summary,
        content,
        hash,
        importance,
        eventType,
        entities: { create: entityIds.map((entityId) => ({ entityId })) },
      },
    });
    if (norm) seenTitles.add(norm);
    if (ckey) seenCross.add(ckey);
    if (bf && entityIds.length > 0) {
      const loose = crossSourceKey(title, entityIds);
      const arr = priorsByTitle.get(loose);
      const entry: PriorFiling = {
        publishedAt: r.publishedAt,
        sourceKey: def.key,
      };
      if (arr) arr.push(entry);
      else priorsByTitle.set(loose, [entry]);
    }
    inserted++;
    tagged += entityIds.length;
  }

  return { source: def.key, fetched: raws.length, inserted, tagged, screened };
}
