/**
 * 催化质量（需求 §6）——纯函数、无 IO、可测。
 *
 * 关键立场：**等级由来源硬度决定，不由大模型的感觉决定**（§11「大模型只负责识别和
 * 解释催化，不负责修改行情数据和数值评分」）。这里直接复用站内已经标定过的六级来源分级
 * `lib/evidence-source.ts`——那套是按真库里实际存在的来源名写的，不是照想象编的词表。
 *
 * 六级 → 需求四档的映射：
 *   L1 交易所公告/财报/监管            → 高
 *   L3 且是**这家公司自己的**硬事实      → 高（订单/中标/合同/涨价/招投标）
 *   L3 行业面数据（销量/产量/出货量）    → 中
 *   L2 管理层口径 / L4 权威媒体          → 中
 *   L5 研报 / L6 传闻                    → 低
 *   没有任何可用资讯                     → 无
 */

import { classifySourceLevel } from "../evidence-source";
import { isDigestWorthyFiling } from "../market-digest";
import type { CatalystGrade } from "./score";

export type CatalystNews = {
  id: string;
  title: string;
  sourceName: string;
  tier: string;
  url: string;
  publishedAt: Date;
  importance: number;
  eventType: string | null;
  /** 这条资讯绑了几个实体。扇出大 = 综述稿，不是这一家的催化 */
  boundCount: number;
};

export type GradedCatalyst = CatalystNews & { grade: CatalystGrade };

/**
 * 「这家公司自己的硬事实」——合同/订单/中标/价格，主体是公司本身。
 * 与之相对的「行业销量/产量」是行业面数据，需求把它列在**中**档。
 */
const COMPANY_HARD_FACT =
  /中标|签订|订单|合同|供货|框架协议|采购协议|提价|涨价|调价|价格.{0,4}(上调|上涨)|招标|投标|获批|注册批件|取得.{0,6}(证书|资质|专利)|量产|投产|扩产/;

/** 绑定扇出超过这个数就是综述稿——「pull 宽 push 严」那条教训里最锋利的判据。 */
export const MAX_BOUND_FANOUT = 4;

/**
 * **催化体裁白名单**——需求 §2-3 点名的那七类：业绩、订单、产品、价格、政策、回购、增持。
 *
 * 为什么必须有这一层：只按来源硬度判，第一版真跑出来的「高级催化」是
 * 「德明利大宗交易：2笔共3510万元」「关于限制性股票激励计划归属条件成就的公告」——
 * 来源确实够硬（交易所披露 / 公司公告），但它们回答不了「为什么可能影响收入、
 * 订单、成本、价格或利润率」。硬度和相关性是两条正交的轴（同「有多硬」vs「说的是谁」那条教训）。
 */
const CATALYST_KIND =
  /业绩|财报|年报|半年报|季报|年度报告|半年度报告|季度报告|中报|预告|预增|预减|扭亏|营收|净利|毛利|订单|合同|中标|招标|供货|框架协议|采购|交付|产品|新品|量产|投产|扩产|产能|技术|专利|获批|注册批件|临床|价格|涨价|提价|调价|报价|销量|出货|需求|政策|规划|补贴|试点|准入|牌照|回购|增持|要约收购|重组|并购|资产注入|战略合作|合资|签约|投资者关系|业绩说明会|电话会|路演|调研/;

/**
 * 交易结构事件：发生在**交易层面**而不是公司经营层面。
 * 它们是行情的结果，不是行情的原因——拿它当催化就是在用涨跌解释涨跌。
 */
const MARKET_PLUMBING =
  /大宗交易|龙虎榜|融资融券|融资余额|股价异动|交易异常波动|停牌|复牌|限制性股票|股权激励|员工持股|归属条件|行权|解禁|质押|冻结|减持计划|股东大会|董事会决议|监事会|独立董事|会计师事务所|信用减值|会计政策/;

/** 标题形如「公司名：正文」时，前缀就是这条消息的主体。 */
function titleSubject(title: string): string | null {
  const m = /^([^：:，,。\s]{2,12})[：:]/.exec(title.trim());
  return m?.[1] ?? null;
}

/** 实体名「城地香江(603887)」→「城地香江」。 */
function bareName(name: string): string {
  return name.replace(/\(\d{4,6}\)\s*$/, "").trim();
}

/**
 * 一条资讯对 `subjectName` 这家公司算不算催化，算的话是哪一档。
 *
 * `subjectName` 传了就做**主体校验**：标题带「别人家：」前缀的（媒体稿里顺带提到
 * 这家公司）不算它的催化——实测「城地香江：…成为中国移动宁夏数据中心中标人」
 * 被算成了中国移动的一手催化。
 */
export function gradeCatalyst(
  n: CatalystNews,
  subjectName?: string,
): CatalystGrade {
  if (n.boundCount > MAX_BOUND_FANOUT) return "NONE";
  if (MARKET_PLUMBING.test(n.title)) return "NONE";
  if (!isDigestWorthyFiling(n.title)) return "NONE";
  if (subjectName) {
    const subj = titleSubject(n.title);
    if (subj && !bareName(subjectName).includes(subj) && !subj.includes(bareName(subjectName)))
      return "NONE";
  }
  const level = classifySourceLevel({
    sourceName: n.sourceName,
    tier: n.tier,
    title: n.title,
  });
  // 五六级（券商观点 / 市场传闻）需求明确归「低」，不过体裁白名单——
  // 白名单是用来决定「高/中」的，不是用来把观点整类删掉的
  if (level >= 5) return "LOW";
  // 一到四级但不属于需求点名的七类体裁 → 不是催化
  if (!CATALYST_KIND.test(n.title)) return "NONE";
  /**
   * 媒体稿要升到「高」，标题里得点名这家公司。
   * 实测「机器人奔向杭州"新考场" 有企业订单已翻番｜活力中国调研行」——
   * 标题里有「订单」两个字，来源分级就给到三级、再被 `COMPANY_HARD_FACT` 提到「高」，
   * 可它讲的是**整个行业**，不是这家公司签了单。一手公告不受此限：公告的主体
   * 由信源权威给出（同 `subjectOnly` 那条教训）。
   */
  const named =
    !subjectName || n.tier === "PRIMARY" || n.title.includes(bareName(subjectName));
  if (level === 1) return "HIGH";
  if (level === 3)
    return COMPANY_HARD_FACT.test(n.title) && named ? "HIGH" : "MEDIUM";
  return "MEDIUM";
}

const ORDER: Record<CatalystGrade, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  NONE: 0,
};

export type CatalystPick = {
  grade: CatalystGrade;
  items: GradedCatalyst[];
  /** 没有可靠催化时给前台的原话（需求 §6 指定文案） */
  emptyNote: string | null;
};

/**
 * 选出最多 `take` 条可点开的证据，并给出整体等级。
 *
 * 整体等级取**最高**那条：一条硬公告就足以支撑「有催化」，不该被同批的研报稀释。
 * 但反过来，只有研报就只能是「低」——这正是 §2-3 里「只有涨幅没有催化不得进入」的抓手。
 */
export function pickCatalysts(
  news: CatalystNews[],
  take: number,
  subjectName?: string,
): CatalystPick {
  const seen = new Set<string>();
  const graded: GradedCatalyst[] = [];
  for (const n of news) {
    const grade = gradeCatalyst(n, subjectName);
    if (grade === "NONE") continue;
    const key = `${n.title.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    graded.push({ ...n, grade });
  }
  graded.sort(
    (a, b) =>
      ORDER[b.grade] - ORDER[a.grade] ||
      b.publishedAt.getTime() - a.publishedAt.getTime() ||
      b.importance - a.importance,
  );
  const items = graded.slice(0, take);
  return {
    grade: items[0]?.grade ?? "NONE",
    items,
    emptyNote:
      items.length === 0
        ? "暂无明确催化，属于资金与价格异动，仍需验证。"
        : null,
  };
}

/**
 * 合并已经分好级的证据（不重新判级）。
 *
 * 用在「板块催化 = 板块自身资讯 + 成分股资讯」这一步：两边都已各自做过主体校验，
 * 再走一次 `pickCatalysts` 会在没有 `subjectName` 的情况下把它们**重新判一遍**，
 * 等于把刚挡掉的东西又放回来（实测「新北洋中标工商银行」就是这样重新混进「银行」的）。
 */
export function mergeGraded(
  groups: GradedCatalyst[][],
  take: number,
): CatalystPick {
  const seen = new Set<string>();
  const all: GradedCatalyst[] = [];
  for (const g of groups)
    for (const item of g) {
      if (seen.has(item.title.trim())) continue;
      seen.add(item.title.trim());
      all.push(item);
    }
  all.sort(
    (a, b) =>
      ORDER[b.grade] - ORDER[a.grade] ||
      b.publishedAt.getTime() - a.publishedAt.getTime(),
  );
  const items = all.slice(0, take);
  return {
    grade: items[0]?.grade ?? "NONE",
    items,
    emptyNote:
      items.length === 0
        ? "暂无明确催化，属于资金与价格异动，仍需验证。"
        : null,
  };
}

/**
 * 合并两类证据，并**给第一类留位**。
 *
 * 为什么需要它：`mergeGraded` 按等级排序取前 N，于是「碳酸锂期货下跌 2.8%」（中档）
 * 会被三条高档公告整个挤掉——实测 7/27 的「电池」板块就是这样，
 * 商品价格明明有料，落库时一条都没留下。
 *
 * 价格与公告是**两个维度**的证据，不该在同一个 top-N 里竞争：
 * 三条公告 + 零条价格，信息量不如两条公告 + 一条价格。
 */
export function mergeReserving(
  reserved: GradedCatalyst[],
  rest: GradedCatalyst[],
  take: number,
  reserveN = 1,
): CatalystPick {
  const byGrade = (a: GradedCatalyst, b: GradedCatalyst) =>
    ORDER[b.grade] - ORDER[a.grade] ||
    b.publishedAt.getTime() - a.publishedAt.getTime();
  const head = [...reserved].sort(byGrade).slice(0, Math.min(reserveN, take));
  const seen = new Set(head.map((i) => i.title.trim()));
  const tail = [...rest]
    .sort(byGrade)
    .filter((i) => !seen.has(i.title.trim()))
    .slice(0, take - head.length);
  const items = [...head, ...tail].sort(byGrade);
  return {
    grade: items.length === 0 ? "NONE" : items[0]!.grade,
    items,
    emptyNote:
      items.length === 0
        ? "暂无明确催化，属于资金与价格异动，仍需验证。"
        : null,
  };
}
