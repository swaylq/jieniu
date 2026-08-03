// 「这条资讯的主体是不是这家公司」——归因证据的准入判据（2026-08-03，潞直报）。相对导入、无 IO、可测。
//
// 反馈现场：国盾量子当天 +4.76%，卡片写「光量子赛道新股密集上市，公司作为产业链龙头或受益于
// 行业关注度提升」。潞：「分析准确性略差一点」「今天观察感觉观察的不对」；
// 张楚寒：「公司确实是产业链龙头，什么光量子新股，我去查一下啥情况」。
//
// 查下来，喂给模型的两条「今日相关」是：
//   · 本周，A股“光”和“芯”新股都来了
//   · 闯关科创板！频准激光全链条自研破局 发力量子与半导体赛道
// 两条都是**频准激光**（一家在申报科创板的激光器公司）的报道，国盾量子只是被列举的**客户**
// （摘要原文：「进入国盾量子、中安半导体等头部企业供应链」）。连模型写的「产业链龙头」四个字
// 都是从摘要里搬的——那是在形容作为客户的国盾量子。实测它近 7 天作为主体的资讯是 **0 条**，
// 也就是说这只股当天根本没有自有事实，正确输出是**留空**。
//
// 根因不在提示词，在「自有事实」的定义：`facts` 取的是「绑定到这只股的资讯」，而绑定是
// **召回导向**的——个股资讯源（东财搜索）按公司名做全文搜索、把搜索结果无条件绑到该股
// （`entityHints`），文本匹配也认摘要里的顺带提及。于是「文章提到了它」＝「关于它的事实」，
// 把 `isValidAttribution` 里「没有事实就留空」这道唯一的护栏顶开，模型顺势编出一条因果。
//
// 这里给出**精度导向**的那把尺子：**主体必须出现在标题里**。同一份绑定，喂给个股页资讯流
// （召回优先，宁多勿漏）与喂给「今天为什么这样走」（精度优先，宁可留空）本来就该用两套门槛，
// 同 lessons「拿浏览门槛当推送门槛」那条。
//
// 实测（2026-08-03，近 7 天 17895 条 COMPANY/STOCK 绑定）：标题命中率合计 51.1%，
// 分源看是两个世界——公告 99.2% / 龙虎榜等结构化事件 100% / 快讯 64.1%，
// 而个股资讯（搜索源）只有 **23.5%**。落到用户看得见的地方：近 6 天 66 只带事实的 mover 里，
// **31 只（47%）的事实全部是「仅提及」**，而模型给其中 59 只都写了归因。
//
// 体裁类噪声（早报 / 收评 / 龙虎榜 / 程序性公告）已由 `isMarketLevelWorthy` 与
// `isDigestWorthyFiling` 在上游挡掉，这里**不重复造尺子**，只回答「主体是谁」这一件事。

import { containsToken } from "./entity-tagging";

export type SubjectEntity = {
  /** 实体名，可带「(代码)」后缀 */
  name: string;
  shortName?: string | null;
  aliases?: string[];
  ticker?: string | null;
};

/**
 * 剥掉证券简称的装饰：尾部「(688027)」、`-U`/`-UW`（未盈利 / 同股不同权），
 * 头部 `N`/`C`（新股上市首日与次 5 日）、`XD`/`XR`/`DR`（除权除息）、`ST`/`*ST`。
 * 这些是**交易状态**，不是名字的一部分——标题里写的永远是干净名字。
 */
export function cleanSecurityName(name: string): string {
  return name
    .replace(/[（(]\d{4,6}[)）]\s*$/, "")
    .replace(/-(?:U|W|D){1,3}$/i, "")
    .replace(/^(?:\*?ST|XD|XR|DR|N|C)(?=[一-鿿])/, "")
    .trim();
}

/**
 * 一家公司的全部叫法（名字 / 简称 / 别名 / 代码），去重。
 * 丢掉长度 < 2 的：单字 token 会命中一切（"C"、"申"）。
 */
export function subjectTokens(e: SubjectEntity): string[] {
  const raw = [
    cleanSecurityName(e.name),
    e.shortName ?? "",
    ...(e.aliases ?? []),
    e.ticker ?? "",
  ];
  const out: string[] = [];
  for (const t of raw) {
    const s = t.trim();
    if (s.length < 2 || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

/** 标题里有没有点到这家公司（名字 / 简称 / 别名 / 代码任一）。 */
export function titleNamesSubject(title: string, e: SubjectEntity): boolean {
  const t = title.trim();
  if (!t) return false;
  return subjectTokens(e).some((tok) => containsToken(t, tok));
}

/**
 * 主体由**来源权威给出**的体裁：公告（源给 secName/secCode）、龙虎榜/大宗/增减持/业绩预告
 * 这类结构化事件、以及研报（subjectOnly）。它们的标题常常不带公司名——巨潮的
 * 「关于回购公司股份的进展公告」是东山精密自己的一手公告，只按标题判会把最值钱的那类事实误杀。
 *
 * 与 runner 里 `subjectOnly` 的立场一致：信源已定主体，别再用文本猜。
 */
export const SUBJECT_AUTHORITATIVE_KINDS = new Set([
  "official-filing",
  "fund-flow",
  "report",
]);

export type FactCandidate = {
  title: string;
  /** `Source.kind` */
  sourceKind?: string | null;
  /** 这条资讯一共绑了几个 COMPANY/STOCK 实体（同一家公司的孪生实体算 2 个） */
  boundEntityCount?: number;
};

/**
 * 这条资讯算不算「这家公司自己的当日事实」（＝可以拿来解释它今天为什么这样走）。
 *
 * 两条路，满足其一即可：
 *   ① **标题点名**了它——媒体稿唯一认的一条；
 *   ② 来源权威给出主体（公告/结构化事件/研报）**且这条只绑了这一家**。
 *
 * ② 上那道扇出闸不是可有可无：这类源实测 99.1%（1698 条里 1682 条）只绑一家公司（孪生 2 个实体），
 * 而绑到第二家的那少数几条恰恰就是「正文顺带提到」的误绑——实测样例「关于深圳嘉立创科技集团
 * 股份有限公司股票上市交易的公告」绑到了平安银行。没有这道闸，权威体裁就成了误绑的后门。
 */
export function isOwnFact(row: FactCandidate, entities: SubjectEntity[]): boolean {
  if (entities.some((e) => titleNamesSubject(row.title, e))) return true;
  const n = row.boundEntityCount ?? 0;
  return (
    !!row.sourceKind &&
    SUBJECT_AUTHORITATIVE_KINDS.has(row.sourceKind) &&
    n > 0 &&
    n <= 2
  );
}

/**
 * 从候选资讯里挑出「主体是这家公司」的那些标题，保序去重、可截断。
 * `entities` 传这家公司的**全部身份**（COMPANY + 它发行的 STOCK 那对孪生实体），
 * 因为名字/别名/代码分散在两侧（COMPANY 无 ticker，STOCK 名字带代码后缀）。
 *
 * 挑不出来就返回空数组——这正是我们要的：**没有自有事实时，归因必须留空**。
 */
export function pickSubjectFacts(
  rows: FactCandidate[],
  entities: SubjectEntity[],
  limit = Infinity,
): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    if (out.includes(r.title)) continue;
    if (!isOwnFact(r, entities)) continue;
    out.push(r.title);
  }
  return out;
}
