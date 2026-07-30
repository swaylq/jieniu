// 复盘的**事件管线**（张楚寒 2026-07-30 反馈）。相对导入、无 IO、可测。
//
// 反馈原话：「现在看起来像『抓到几条新闻，然后让模型总结』。建议改成：
//   1. 每天先形成 30—80 个候选事件
//   2. 去重并合并同一主题的多条新闻
//   3. 按宏观、全球市场、行业、公司、资金、日历分类
//   4. 检查每个类别是否存在重大遗漏
//   5. 从中选出 15—25 个真正重要的事件
//   6. 最后才让模型生成总判断」
//
// 这个文件是第 1–5 步，**全部纯规则、零 AI**。他建议「便宜模型负责分类、聚类和打标」，
// 但这几件事规则做得更好也更省：分类靠词表、聚类靠字符二元组、打标靠既有评分——
// 零 token、确定性、可单测。省下来的预算全给第 6 步（强模型只看 15–25 条）。
//
// 排序按他给的六条判据，每条**单独记账**（`reasons`）：市场影响程度 / 与当日涨跌的解释力 /
// 信息新鲜度 / 来源可靠性 / 与用户持仓的相关度 / 是否改变原有投资逻辑。
// 分数是黑箱就没法复核选材对不对——上一轮「三层信息不足」的教训就是分数不可观测。

import { charBigrams, titleSimilarity } from "./event-cluster";
import { marketRelevanceScore, macroSubjectOf } from "./macro-relevance";
import { classifyScope } from "./digest-substance";

export const CATEGORIES = [
  "global",
  "macro",
  "industry",
  "company",
  "flow",
  "calendar",
] as const;

export type EventCategory = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  global: "全球市场",
  macro: "国内宏观",
  industry: "行业",
  company: "公司",
  flow: "资金",
  calendar: "日历",
};

export type RawEvent = {
  id: string;
  title: string;
  brief: string;
  source: string;
  /** PRIMARY = 公司公告 / 交易所；其余为媒体。来源可靠性判据用它。 */
  tier: string;
  importance: number;
  publishedAt: Date;
  entityNames: string[];
  entityIds: string[];
  entityTypes: string[];
  eventType: string | null;
};

// ---------------------------------------------------------------------------
// 第 3 步：分类
// ---------------------------------------------------------------------------

/**
 * 资金体裁。**优先于公司绑定**——龙虎榜绑着个股，但它讲的是资金流向不是这家公司的经营。
 * 这条顺序是有意的：不这么排，「资金」这一类会被公司类整个吸干。
 */
const FLOW =
  /龙虎榜|大宗交易|北向资金|南向资金|主力(资金|净[流买卖])|资金流[向入出]|融资(余额|净买入|融券)|两融|ETF.{0,8}(份额|净申购|净流入)|成交额|换手率|沪股通|深股通|机构专用席位|净买入|净卖出/;

/**
 * 日历体裁：讲的是「**将要**发生」，不是「发生了什么」。
 * 刻意**不收**：「上市首日」「破发」（已发生的公司事件），以及「限售股解禁」「除权除息」
 * （绑着具体公司，归公司才对——实测「限售股解禁前夕，SpaceX获美国太空军16亿美元订单」
 * 因为标题里出现「限售股解禁」被归进日历，而它讲的是 SpaceX 的订单）。
 */
const CALENDAR =
  /预约披露|披露(时间|日期|截止)|将于\d|定于\d|下周.{0,6}(看点|前瞻|关注)|本周.{0,4}(看点|前瞻)|财经日历|即将(公布|发布|上市|披露|开始)|(明|次)日.{0,6}(公布|发布|披露|上市)/;

/** 只表示「在哪个市场」的场所词，本身不说明这条消息属于海外那一层。 */
const VENUE_ONLY = /港股|美股|H股|赴港|赴美|美国存托/g;

/**
 * 一条资讯属于六类中的哪一类。
 * 优先级：日历 → 资金 → 标题级全球/宏观 → 公司 → 摘要级全球/宏观 → 行业。
 *
 * 「标题级」与「摘要级」必须分开，中间夹一道公司绑定——这是实测踩出来的：
 * `classifyScope` 在标题判不出时会拿 `标题+摘要` 再判一次，于是摘要里随便一个
 * 「私募」「险资」就把「宁德时代关联企业参设并购基金」拽进国内宏观。第一版跑真库，
 * **国内宏观 6 条全是公司事件**（宁德时代回购潮、兆易创新增持、QFII 调仓…）。
 * 一条绑着具体公司、标题里又没有宏观/海外主体的资讯，就是公司事件——别让摘要改判。
 */
export function categorize(e: RawEvent): EventCategory {
  const t = e.title;
  if (CALENDAR.test(t)) return "calendar";
  if (FLOW.test(t)) return "flow";

  const hasCompany = e.entityTypes.some((x) => x === "COMPANY" || x === "STOCK");

  // ① 标题自己说了算
  const byTitle = classifyScope(t, "");
  if (byTitle === "overseas") {
    // 但「场所词」不算海外事件：「中际旭创港股上市首日开盘报971港元」讲的是这家 A 股公司，
    // 不是隔夜海外市场。判据是把场所词剥掉后还剩不剩海外信号——剥完就不是了，说明
    // 命中的只是「在哪儿上市/交易」。读者点开「全球市场」想看的是美联储和海外龙头。
    const stripped = classifyScope(t.replace(VENUE_ONLY, ""), "");
    if (!(hasCompany && stripped !== "overseas")) return "global";
  } else if (byTitle === "domestic") {
    return "macro";
  }

  // ② 绑了公司 → 公司事件，摘要没有改判权
  if (hasCompany) return "company";

  // ③ 没绑公司才让摘要参与判断（市场级条目标题常常很短）
  const byBrief = classifyScope(t, e.brief);
  if (byBrief === "overseas") return "global";
  if (byBrief === "domestic") return "macro";
  return "industry";
}

// ---------------------------------------------------------------------------
// 第 2 步：去重并合并同一主题的多条新闻
// ---------------------------------------------------------------------------

export type MergedEvent = RawEvent & {
  /** 被合并进来的条数（含自己）。多源同时报道 = 更重要，进排序。 */
  mergedCount: number;
  /** 所有来源名，抽屉/提示词里可以说明「N 家同时报道」。 */
  sources: string[];
};

/** 一手来源优先；同档取 importance 高的，再同则取更早那条（首发）。 */
function better(a: RawEvent, b: RawEvent): RawEvent {
  const pa = a.tier === "PRIMARY" ? 1 : 0;
  const pb = b.tier === "PRIMARY" ? 1 : 0;
  if (pa !== pb) return pa > pb ? a : b;
  if (a.importance !== b.importance) return a.importance > b.importance ? a : b;
  return a.publishedAt <= b.publishedAt ? a : b;
}

/**
 * 二元组**包含率**（overlap coefficient）：|A∩B| / min(|A|,|B|)。
 *
 * 用它而不是 Jaccard，是因为跨源重复的两条长度常常差一倍——
 * 「澜起科技：首次回购50万股A股股份 回购金额约1.03亿元」与
 * 「澜起科技：公司通过集中竞价交易方式首次回购A股股份50万股，支付金额约1.03亿元」
 * 实测 Jaccard 只有 0.452（被长度差惩罚），包含率是 0.792。
 * Jaccard 阈值要压到 0.45 才收得住这一对，那时不相干的条目也会被并进来。
 *
 * 代价：短标题的二元组容易被长标题整体覆盖，所以两条都短于 8 字时退回 Jaccard。
 */
export function bigramContainment(a: string, b: string): number {
  const A = charBigrams(a);
  const B = charBigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

const MERGE_THRESHOLD = 0.72;

/**
 * 合并同一主题。判据：**标题字符二元组相似度** + 主体一致。
 *
 * 用二元组而不是前缀子串，是因为跨源重复常常语序不同——
 * 「业绩确定叠加分红稳定 沪主板蓝筹走强」与「沪主板蓝筹逆势走强 业绩确定叠加分红稳定」
 * 互不为子串，但二元组几乎全重合。
 *
 * 主体一致的要求防止「澜起科技回购 50 万股」与「江波龙回购 50 万股」被并成一条：
 * 两条标题相似度很高，但讲的是两家公司。没有绑定的（市场级）不做这道约束。
 */
export function mergeEvents(
  events: RawEvent[],
  threshold = MERGE_THRESHOLD,
): MergedEvent[] {
  const out: MergedEvent[] = [];
  for (const e of events) {
    const hit = out.find((m) => {
      const short = m.title.length < 8 || e.title.length < 8;
      const sim = short
        ? titleSimilarity(m.title, e.title)
        : bigramContainment(m.title, e.title);
      if (sim < threshold) return false;
      const a = new Set(m.entityIds);
      const b = e.entityIds;
      if (a.size === 0 && b.length === 0) return true; // 都是市场级
      if (a.size === 0 || b.length === 0) return false;
      return b.some((x) => a.has(x));
    });
    if (!hit) {
      out.push({ ...e, mergedCount: 1, sources: [e.source] });
      continue;
    }
    const keep = better(hit, e);
    const mergedCount = hit.mergedCount + 1;
    const sources = hit.sources.includes(e.source)
      ? hit.sources
      : [...hit.sources, e.source];
    Object.assign(hit, keep, { mergedCount, sources });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 第 5 步：排序（张楚寒的六条判据）
// ---------------------------------------------------------------------------

export type RankContext = {
  now: Date;
  /** 当日强弱板块名 + 涨跌幅最大的个股名——「与当日涨跌的解释力」靠它判。 */
  hotSubjects: Set<string>;
  /** 有人自选/持仓的实体名——「与用户持仓的相关度」。 */
  heldSubjects: Set<string>;
  /** 触及了某条投资逻辑的资讯 id——「是否改变原有投资逻辑」。 */
  thesisTouched: Set<string>;
};

export type ScoredEvent = MergedEvent & {
  category: EventCategory;
  score: number;
  /** 六条判据各自的贡献。**必须留着**：分数是黑箱就没法复核选材对不对。 */
  reasons: Record<string, number>;
};

/** 权威媒体：不是一手，但比自媒体/聚合号可靠。 */
const CREDIBLE_MEDIA =
  /新华|人民日报|证券时报|上海证券报|中国证券报|证券日报|财联社|经济日报|央视|第一财经|界面|21世纪经济报道|华尔街见闻/;

const FRESH_WINDOW_HOURS = 24;

export function scoreEvent(
  e: MergedEvent & { category: EventCategory },
  ctx: RankContext,
): ScoredEvent {
  const subjects = e.entityNames;
  const hours =
    (ctx.now.getTime() - new Date(e.publishedAt).getTime()) / 3_600_000;

  const reasons: Record<string, number> = {
    // ① 市场影响程度——复用既有的相关性尺子（硬事件/金额/外生主体加分，行政通报/指数复述减分）
    market: Math.round(marketRelevanceScore(e.title, e.brief) * 1.5),
    // ② 与当日涨跌的解释力：主体出现在今天的强弱板块 / 大幅波动个股里
    "与当日涨跌的解释力": subjects.some((s) => ctx.hotSubjects.has(s)) ? 12 : 0,
    // ③ 信息新鲜度：24 小时线性衰减，隔夜的仍算数（A 股开盘前的海外消息最重要）
    信息新鲜度: Math.round(10 * Math.max(0, 1 - hours / FRESH_WINDOW_HOURS)),
    // ④ 来源可靠性
    来源可靠性: e.tier === "PRIMARY" ? 8 : CREDIBLE_MEDIA.test(e.source) ? 4 : 0,
    // ⑤ 与用户持仓的相关度——**权重最高**，这份复盘是写给他的，不是写给市场的
    用户持仓相关度: subjects.some((s) => ctx.heldSubjects.has(s)) ? 15 : 0,
    // ⑥ 是否改变原有投资逻辑：这条资讯为某条投资命题提供过证据
    是否改变投资逻辑: ctx.thesisTouched.has(e.id) ? 18 : 0,
    // 多源印证不在他列的六条里，但它是「重要性」的直接证据，且几乎零成本
    多源印证: Math.min(6, (e.mergedCount - 1) * 3),
  };

  const score = Object.values(reasons).reduce((a, b) => a + b, 0);
  return { ...e, score, reasons };
}

// ---------------------------------------------------------------------------
// 第 5 步：选材（每类配额 + 全局上限）
// ---------------------------------------------------------------------------

export type SelectOpts = {
  min: number;
  max: number;
  /** 每类至少给几条（该类池子够的话）——防止公司类把全部名额吃干。 */
  perCategoryFloor: number;
  /** 每类最多几条。 */
  perCategoryCap: number;
  /**
   * **同一主体在同一类里最多几条**。没有这道闸，一件大事的连续追更会把整类占满——
   * 实测公司类 8 个位置有 6 个是「兆易创新朱一明套现44亿后增持回购」的不同写法。
   * 这类重复靠标题相似度是收不住的（措辞、角度、数字侧重全不同），只有主体是同一个。
   */
  perSubjectCap?: number;
};

/** 一条事件的「主体」：优先取绑定实体，没有绑定就从标题里认宏观主体（美联储/央行…）。 */
function subjectOf(e: ScoredEvent): string | null {
  const named = e.entityNames.find((n) => n.length >= 2);
  return named ?? macroSubjectOf(e.title);
}

/**
 * 选出 15–25 条。两轮：
 *   ① 先按类保底（每类取 floor 条最高分）——分层选材必须给每层独立配额，
 *      否则弱势层会在同一个排序里被系统性挤空（上一轮「三层信息不足」的教训）；
 *   ② 再按全局分数补到 max，受每类 cap 约束。
 * 池子不够就有几条给几条，**不硬凑**。
 */
export function selectEvents(
  scored: ScoredEvent[],
  opts: SelectOpts,
): ScoredEvent[] {
  const byCat = new Map<EventCategory, ScoredEvent[]>();
  for (const c of CATEGORIES) byCat.set(c, []);
  for (const e of scored) byCat.get(e.category)?.push(e);
  for (const list of byCat.values()) list.sort((a, b) => b.score - a.score);

  const picked: ScoredEvent[] = [];
  const takenPerCat = new Map<EventCategory, number>();
  const takenPerSubject = new Map<string, number>();
  const subjCap = opts.perSubjectCap ?? Infinity;

  /** 同类同主体是否已经满了。主体认不出来（纯市场级）就不限。 */
  const subjectFull = (e: ScoredEvent): boolean => {
    const s = subjectOf(e);
    if (!s) return false;
    return (takenPerSubject.get(`${e.category}|${s}`) ?? 0) >= subjCap;
  };
  const noteSubject = (e: ScoredEvent) => {
    const s = subjectOf(e);
    if (!s) return;
    const k = `${e.category}|${s}`;
    takenPerSubject.set(k, (takenPerSubject.get(k) ?? 0) + 1);
  };

  for (const c of CATEGORIES) {
    const list = byCat.get(c)!;
    let taken = 0;
    for (const e of list) {
      if (taken >= opts.perCategoryFloor) break;
      if (subjectFull(e)) continue;
      picked.push(e);
      noteSubject(e);
      taken++;
    }
    takenPerCat.set(c, taken);
  }

  const rest = scored
    .filter((e) => !picked.includes(e))
    .sort((a, b) => b.score - a.score);
  for (const e of rest) {
    if (picked.length >= opts.max) break;
    const n = takenPerCat.get(e.category) ?? 0;
    if (n >= opts.perCategoryCap) continue;
    if (subjectFull(e)) continue;
    picked.push(e);
    noteSubject(e);
    takenPerCat.set(e.category, n + 1);
  }

  // 每类上限的目的是**防止一类挤掉别类**，不是让复盘饿着。若受限后还不到下限，
  // 就放开上限继续补——某天确实只有公司类有事，那这一天的复盘就该全是公司事件。
  if (picked.length < opts.min) {
    for (const e of rest) {
      if (picked.length >= Math.min(opts.min, opts.max)) break;
      if (picked.includes(e)) continue;
      picked.push(e);
    }
  }

  return picked.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// 第 4 步：检查每个类别是否存在重大遗漏
// ---------------------------------------------------------------------------

export type CoverageRow = {
  category: EventCategory;
  label: string;
  pool: number;
  picked: number;
  /** 池子里有料却一条都没选中 = 遗漏。池子本来就空不算遗漏（今天真没这类事）。 */
  gap: boolean;
};

export function coverageReport(
  pool: ScoredEvent[],
  picked: ScoredEvent[],
  floor: number,
): CoverageRow[] {
  const pickedIds = new Set(picked.map((p) => p.id));
  return CATEGORIES.map((c) => {
    const inPool = pool.filter((e) => e.category === c).length;
    const inPicked = pool.filter(
      (e) => e.category === c && pickedIds.has(e.id),
    ).length;
    return {
      category: c,
      label: CATEGORY_LABEL[c],
      pool: inPool,
      picked: inPicked,
      gap: inPool > 0 && inPicked < Math.min(floor, inPool),
    };
  });
}
