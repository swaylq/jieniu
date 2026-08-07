/**
 * 「个股决策卡」的五模型判定（2026-08-06，按张楚寒新一轮反馈重做）。
 *
 * ## 这一轮改的是什么
 *
 * 上一版（`watch-status.ts`）只回答「你设的条件动了没有」，四行条件表、一个状态词。
 * 新反馈要的是**把判断拆开摆出来**：
 *
 *   ① 最上面直接给一个来自固定枚举的结论（逻辑明显增强 / 小幅增强 / 暂无实质变化 /
 *      多空证据冲突 / 逻辑出现削弱 / 核心逻辑可能被破坏 / 数据不足无法判断）；
 *   ② 拆成五个模型，不许混成一句话，每个模型能点开看依据；
 *   ③ 给「你的条件完成了几项」，不给买卖点；
 *   ④ 每个结论都能点回证据，数据不足必须允许不下判断，模型冲突必须显式展示。
 *
 * ## 五个模型各自吃的是**不同的数据源**，不是把同一池信号切五刀
 *
 * 切五刀会造出「假的多样性」——五个模型永远同向，一致性 5/5 天天满分，没有信息量。
 * 所以每个模型钉死一个独立来源：
 *
 * | 模型 | 数据源 | 独立性 |
 * |---|---|---|
 * | 基本面 | 打到**经营族**维度上的信号（90 天）+ 最近一次业绩类披露 | 公司自己的经营事实 |
 * | 估值与预期 | `EntitySignal.consensus`（东财机构一致预期：覆盖家数/评级分布/两年 EPS） | 卖方的预期 |
 * | 事件 | 近 30 天一手结构化事件（`NewsItem.eventType` + PRIMARY 档）与其方向 | 交易所/公司公告 |
 * | 趋势与资金 | `MarketDaily`（涨跌幅链 + 主力净额） | 市场行为 |
 * | 风险 | 解禁 / 融资余额 / 负面事件 / 偏恶化信号 | 反方证据 |
 *
 * ## 为什么是纯规则、零 AI
 *
 * 沿用复盘六步管线与上一版观察卡的既定做法：判定是确定性的、可单测的。更重要的是
 * **AI 在这里帮不上忙**——五个模型的输入都是结构化数字，让模型复述一遍只会引入不稳定，
 * 还多一处要过合规。这里连措辞都写死在代码里。
 *
 * ## 合规红线（铁律②）
 *
 * 所有档位词都是**信息状态**（改善 / 走弱 / 未变化 / 待确认 / 中高），不是操作建议。
 * 趋势模型只陈述已经发生的价格与资金事实，绝不出现「突破」「支撑」「金叉」这类
 * 自带动作暗示的技术分析词。单测里有一条机械扫描钉住这一点。
 *
 * ## 不在这一版里的：「历史相似状态」
 *
 * 反馈里的第 4 条（「过去 5 年出现过 18 次相似状态，未来 20 个交易日上涨 11 次…」）
 * **没做**，因为做不了：`MarketDaily` 目前每只股最多 143 根日线（约 7 个月），
 * 连一次完整的年度周期都不够，谈不上「过去 5 年」。硬做出来就是拿 3 个样本冒充统计——
 * 正是这份反馈自己反对的那种「把错误包装得更可信」。要做得先把日线回填到 5 年。
 */

import { dimensionFamily } from "./evidence";
import { SENSITIVITY_THRESHOLD, type UserDimension } from "./user-thesis";
import {
  mean,
  netFlowSum,
  positiveFlowDays,
  returnOverDays,
  type RadarBar,
} from "./radar/series";

// ---------------------------------------------------------------------------
// 窗口常数
// ---------------------------------------------------------------------------

/** 「近期」＝ 30 天：一个完整的公告/资讯节奏周期（沿用上一版观察卡）。 */
export const RECENT_DAYS = 30;
/** 经营面看得更长：一个季度才够看出「改善还是走弱」。 */
export const OPERATING_DAYS = 90;
/** 到价提醒触发后还算「刚触发」的窗口。 */
export const TRIGGER_DAYS = 7;
/** 条件「新满足」的窗口——用来回答「比上次多了几项」。 */
export const NEWLY_MET_DAYS = 7;
/** 趋势模型的最少日线根数。少于这个数不给方向（宁可留空）。 */
export const MIN_BARS = 25;

// ---------------------------------------------------------------------------
// 输入
// ---------------------------------------------------------------------------

/** 已过证据判据的逻辑信号（`entity.thesisSignals` 的产物，只取这里用得到的字段）。 */
export type CardSignal = {
  dimensionKey: string;
  direction: string; // bull | bear | neutral
  materiality: number;
  fact: string;
  grade: string; // direct | supporting
  /** 旧行可能没有关联资讯——那就没有「点回证据」的落点，不是错误。 */
  newsId: string | null;
  newsTitle: string;
  sourceName: string;
  publishedAt: Date | string;
};

/** 结构化事件（`NewsItem` 里带 `eventType` 的那些）。 */
export type CardEvent = {
  eventType: string;
  title: string;
  tier: string; // PRIMARY | ...
  newsId: string;
  publishedAt: Date | string;
};

export type CardAlert = {
  active: boolean;
  triggeredAt: Date | string | null;
  /** 展示用的一句话（如「跌到 24.00 元」）。缺省时退回通用措辞。 */
  label?: string | null;
};

export type CardConsensus = {
  orgNum: number;
  buy: number;
  add: number;
  neutral: number;
  eps: { year: string; eps: number }[];
  asOf: Date | string | null;
};

export type DecisionInput = {
  now?: Date;
  /** 用户有没有自己的投资逻辑（没有的话条件完成度无从谈起）。 */
  dims: UserDimension[];
  /** 逻辑信号（**未**个性化的全量；本模块按维度阈值自己筛，好把「被谁滤掉」讲清楚）。 */
  signals: CardSignal[];
  /** 未达证据标准被滤掉的条数——空态要说实话。 */
  dropped?: number;
  alerts: CardAlert[];
  events: CardEvent[];
  consensus: CardConsensus | null;
  /** 配对股票的日线，**升序**，最后一根最新。 */
  bars: RadarBar[];
  /** 解禁信号（`EntitySignal.unlock` 的 detail）。 */
  unlock: { freeDate: string; ratio: number; type: string } | null;
  /** 融资余额（`EntitySignal.margin` 的 detail）：余额（元）与占流通比（%）。 */
  margin: { rzye: number; zb: number } | null;
};

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

export type ModelKey =
  | "fundamental"
  | "valuation"
  | "event"
  | "trend"
  | "risk";

/**
 * 模型对**投资逻辑**的指向。刻意不叫 bull/bear——那是对股价的判断，这里说的是
 * 「支持你的命题 / 与你的命题相悖 / 没动 / 没料可判」。
 */
export type ModelStance = "support" | "against" | "flat" | "unknown";

export type ModelBasis = {
  /** 一句可核查的事实（必须带数字或专有名词，不许是「受板块影响」这种同义反复）。 */
  text: string;
  /** 点回证据：资讯 id。没有对应新闻的（如行情统计）为空。 */
  newsId?: string;
  source?: string;
};

export type ModelRead = {
  key: ModelKey;
  name: string;
  stance: ModelStance;
  /** 该模型自己的档位词（各模型词表不同，别统一——「中高」只对风险有意义）。 */
  level: string;
  basis: ModelBasis[];
  /** 数据不足时说清缺的是什么；有料时为空。 */
  missing: string | null;
  /** 数据的 as-of 说明（哪天的数、什么口径）。 */
  asOf: string | null;
};

/** 固定枚举——反馈里点名的七个允许状态，一个不多一个不少。 */
export type CardVerdict =
  | "strengthen_strong"
  | "strengthen_mild"
  | "no_change"
  | "conflict"
  | "weaken"
  | "broken"
  | "insufficient";

export type ConditionState = "met" | "pending" | "adverse";

export type ConditionItem = {
  label: string;
  state: ConditionState;
  /** 满足/恶化的依据（一句话 + 可点回的资讯）。pending 时说明还缺什么。 */
  detail: string;
  newsId?: string;
  /** 近 7 天才满足的——用来回答「比上次多了几项」。 */
  fresh: boolean;
  /** 用户标为重点的维度排在前面。 */
  priority: boolean;
};

export type DecisionCard = {
  verdict: CardVerdict;
  verdictLabel: string;
  /** hero 大标题：一句完整的话。 */
  headline: string;
  /** 「5 个模型中 2 项改善、1 项走弱、2 项待确认」——反馈里点名要的那一行。 */
  tally: string;
  /** 展开说明：系统做了什么、没做什么。 */
  body: string;
  models: ModelRead[];
  /** 模型一致性：有明确方向的模型里，指向同一侧的个数。**不是涨跌概率**。 */
  agreement: { same: number; total: number; note: string };
  conditions: {
    met: number;
    total: number;
    freshlyMet: number;
    items: ConditionItem[];
    /** 用户还没写下自己的逻辑时为 true——此时整块不该渲染成「0/0」。 */
    unset: boolean;
  };
  /** 最重要的新增证据（近 30 天材料度最高的一手事实）。 */
  topEvidence: ModelBasis | null;
  /** 最大的不确定性——一句话说清「什么仍然不成立」。 */
  topUncertainty: string | null;
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function toTime(v: Date | string): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

function daysAgo(v: Date | string, now: Date): number {
  return (now.getTime() - toTime(v)) / 86_400_000;
}

function within(v: Date | string, now: Date, days: number): boolean {
  const d = daysAgo(v, now);
  return d >= 0 ? d <= days : true; // 未来时间（数据源时区偏差）按「刚发生」算
}

/** 保留一位小数，去掉多余的 `.0`。 */
function fx(v: number, digits = 1): string {
  return Number(v.toFixed(digits)).toString();
}

/** 元 → 「N 亿」/「N 万」。资金数字直接写元没人读得动。 */
export function money(yuan: number): string {
  const abs = Math.abs(yuan);
  if (abs >= 1e8) return `${fx(yuan / 1e8, 2)} 亿元`;
  if (abs >= 1e4) return `${fx(yuan / 1e4, 0)} 万元`;
  return `${fx(yuan, 0)} 元`;
}

function ymd(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  // 日历日按**本地时区**取。`toISOString().slice(0,10)` 会把本地 8/6 写成 8/5。
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 某维度按用户敏感度的材料度门槛。维度不在用户清单里（或没有 thesis）时按 normal 档，
 * 这样「还没写逻辑」的用户也能看到事件/趋势/风险三个不依赖 thesis 的模型。
 */
function threshold(dims: UserDimension[], key: string): number {
  const d = dims.find((x) => x.key === key);
  if (!d) return SENSITIVITY_THRESHOLD.normal;
  return SENSITIVITY_THRESHOLD[d.sensitivity];
}

/** 用户在监控的信号：维度未静音 + 材料度过该维度的门槛。没有 thesis 时全量放行。 */
function watched(input: DecisionInput, s: CardSignal): boolean {
  if (input.dims.length === 0) return true;
  const d = input.dims.find((x) => x.key === s.dimensionKey);
  if (!d || d.muted) return false;
  return s.materiality >= SENSITIVITY_THRESHOLD[d.sensitivity];
}

function basisOf(s: CardSignal): ModelBasis {
  return { text: s.fact, newsId: s.newsId ?? undefined, source: s.sourceName };
}

/**
 * **每个命题只留最强的一条证据**。
 *
 * 真实数据冒烟里澜起科技的基本面依据是三条同一次回购的追更（「回购金额较大」「累计回购
 * 70.5 万股」「一季度归母净利润 8.47 亿、回购 1.44 亿」），三条并排看着像三份证据，
 * 其实是一件事。同一件事的重复靠**主体收口**（这里是维度）而不是标题近重复来拦——
 * 措辞和数字都不一样，字符串比对一条都拦不住（复盘那轮同一个教训）。
 */
function bestPerDimension(signals: CardSignal[]): CardSignal[] {
  const best = new Map<string, CardSignal>();
  for (const s of signals) {
    const cur = best.get(s.dimensionKey);
    const better =
      !cur ||
      (s.grade === "direct" && cur.grade !== "direct") ||
      (s.grade === cur.grade && s.materiality > cur.materiality);
    if (better) best.set(s.dimensionKey, s);
  }
  return [...best.values()].sort((a, b) => {
    const ga = a.grade === "direct" ? 1 : 0;
    const gb = b.grade === "direct" ? 1 : 0;
    if (ga !== gb) return gb - ga;
    return b.materiality - a.materiality;
  });
}

// ---------------------------------------------------------------------------
// 结构化事件的方向
// ---------------------------------------------------------------------------

/**
 * `eventType` 是采集层给的**权威标签**（不是我从标题猜的），所以这里可以按体裁定方向。
 *
 * 刻意留了一批「方向未知」：`业绩预告` 可以是预增也可以是预减、`重组` 可能是好事也可能
 * 是保壳、`研报` 只是一次覆盖事件。这些一律记成中性并如实标注——按体裁猜方向正是
 * 「把错误包装得更可信」的典型做法。真正的方向由打到维度上的信号（有 `direction`）给出。
 */
const EVENT_POLARITY: Record<string, 1 | -1> = {
  中标: 1,
  增持: 1,
  回购: 1,
  分红: 1,
  股权激励: 1,
  减持: -1,
  监管: -1,
  问询: -1,
  质押: -1,
  诉讼: -1,
  立案: -1,
};

/** 明确属于「负面/需要复核」的体裁——风险模型直接数它们。 */
const RISK_EVENTS = new Set(["减持", "监管", "问询", "质押", "诉讼", "立案"]);
/**
 * 市场微结构体裁：是「谁在买卖」，不是「公司发生了什么」。计数照算（它们确实是事件），
 * 但不进「现在发生了什么」那两行——冒烟里宁德时代的头条曾经是「大宗交易：1 笔共 608 万元，
 * 均溢价 0%」，把一条零信息的撮合记录摆在了公司当期最重要事件的位置上。
 */
const MICROSTRUCTURE_EVENTS = new Set([
  "大宗交易",
  "龙虎榜",
  "融资融券",
  "股价异动",
]);
/** 业绩类披露：基本面模型拿它当「上次有事实可核是什么时候」的锚点。 */
const EARNINGS_EVENTS = new Set(["财报", "业绩预告", "业绩快报"]);

// ---------------------------------------------------------------------------
// 模型 ①：基本面
// ---------------------------------------------------------------------------

function fundamentalModel(input: DecisionInput, now: Date): ModelRead {
  const sigs = input.signals.filter(
    (s) =>
      watched(input, s) &&
      within(s.publishedAt, now, OPERATING_DAYS) &&
      dimensionFamily(s.dimensionKey) === "operating",
  );
  const bull = sigs.filter((s) => s.direction === "bull");
  const bear = sigs.filter((s) => s.direction === "bear");

  // 「上次业绩披露」只认**一手**（PRIMARY）。冒烟里这里一度指向「月内超 600 家 A 股上市
  // 公司获机构调研，电子行业受青睐」——一篇被打上「财报」体裁的媒体综述，摆在「最近一次
  // 业绩类披露」的位置上是直接的错误信息。
  const lastEarnings = input.events
    .filter((e) => EARNINGS_EVENTS.has(e.eventType) && e.tier === "PRIMARY")
    .sort((a, b) => toTime(b.publishedAt) - toTime(a.publishedAt))[0];

  const basis: ModelBasis[] = [];
  for (const s of bestPerDimension(sigs).slice(0, 3)) basis.push(basisOf(s));
  if (lastEarnings)
    basis.push({
      text: `最近一次业绩类披露：${ymd(lastEarnings.publishedAt)}「${lastEarnings.title}」`,
      newsId: lastEarnings.newsId,
    });

  // 一条经营面事实都没有 → 老老实实说不知道。这里绝不能退回「受行业景气影响」这类
  // 换一天也成立的同义反复（复盘那轮的教训：模型没有事实可用时不会留空，会退回废话）。
  if (sigs.length === 0 && !lastEarnings)
    return {
      key: "fundamental",
      name: "基本面",
      stance: "unknown",
      level: "数据不足",
      basis: [],
      missing: `近 ${OPERATING_DAYS} 天没有打到经营类命题上的可核事实，也没有业绩类披露`,
      asOf: null,
    };

  let stance: ModelStance;
  let level: string;
  if (bull.length >= 2 && bull.length > bear.length * 2) {
    stance = "support";
    level = "改善";
  } else if (bear.length >= 2 && bear.length > bull.length) {
    stance = "against";
    level = "走弱";
  } else if (bull.length > 0 && bear.length > 0) {
    stance = "flat";
    level = "多空并存";
  } else if (bull.length === 1) {
    stance = "support";
    level = "有单条改善";
  } else if (bear.length === 1) {
    stance = "against";
    level = "有单条走弱";
  } else {
    stance = "flat";
    level = "暂无改变";
  }

  return {
    key: "fundamental",
    name: "基本面",
    stance,
    level,
    basis,
    missing: null,
    asOf: `经营类命题 · 近 ${OPERATING_DAYS} 天 ${sigs.length} 条可核事实`,
  };
}

// ---------------------------------------------------------------------------
// 模型 ②：估值与预期
// ---------------------------------------------------------------------------

/**
 * 名字刻意叫「估值与预期」而不是「估值」：解牛库里**没有**存 PE 分位（那是实时向东财取的，
 * 见 `valuation-context.ts`，走 Suspense 流式补在页面下方），这张卡如果为了凑一个「估值」
 * 模型去等那个外部请求，就会把整张卡拖到关键路径上。
 *
 * 所以这个槽位吃的是库里已有的**机构一致预期**：覆盖家数、评级分布、未来两年 EPS 预期。
 * 它回答的是「卖方的预期在往哪走」，不是「现在贵不贵」——后者明确交回给下方的估值对照卡，
 * 措辞里写死这句，免得用户把两件事当成一件。
 */
function valuationModel(input: DecisionInput): ModelRead {
  const c = input.consensus;
  if (!c || c.orgNum <= 0)
    return {
      key: "valuation",
      name: "估值与预期",
      stance: "unknown",
      level: "无机构覆盖 · 待量化",
      basis: [],
      missing: "没有机构一致预期数据；当前 PE 与历史分位见下方「估值对照」",
      asOf: null,
    };

  const basis: ModelBasis[] = [];
  const rated = c.buy + c.add + c.neutral;
  basis.push({
    text:
      `${c.orgNum} 家机构覆盖` +
      (rated > 0
        ? `，评级分布 买入 ${c.buy} / 增持 ${c.add} / 中性 ${c.neutral}` +
          (c.orgNum > rated ? ` / 未披露 ${c.orgNum - rated}` : "")
        : ""),
  });

  /**
   * **这个模型只往下投票，不往上投票**——这是拿真实分布量出来的，不是保守。
   *
   * 全库 798 份一致预期里，次年 EPS 预期增速的中位数是 **+33%**、p75 是 +96%，
   * 「增速 ≥15%」占 **68%**。也就是说「机构预期高增」在 A 股是**默认档**，没有鉴别力：
   * 拿它当一张支持票，等于给三分之二的卡凭空加一分，把每张卡都推向「逻辑增强」。
   * （同一个形状：importance 在默认档 30 挤了 681 条，那轮的结论是「默认档没有鉴别力时
   * 别去调门槛，另立一把尺子」。）
   *
   * 真正有信息量的是**下滑**那 7%。而「上修还是下修」这个本该最有用的判断做不了——
   * 库里只存了一致预期的**当前快照**，没有历史，无从对照。这一点如实写在 missing 里，
   * 而不是拿「当前增速」冒充「预期在变好」。
   */
  const eps = [...c.eps].sort((a, b) => a.year.localeCompare(b.year)).slice(-2);
  let stance: ModelStance = "flat";
  let level = "预期未量化";
  if (eps.length === 2 && Math.abs(eps[0]!.eps) > 1e-6) {
    const g = ((eps[1]!.eps - eps[0]!.eps) / Math.abs(eps[0]!.eps)) * 100;
    basis.push({
      text: `一致预期 EPS：${eps[0]!.year} 年 ${fx(eps[0]!.eps, 2)} 元 → ${eps[1]!.year} 年 ${fx(eps[1]!.eps, 2)} 元（${g >= 0 ? "+" : ""}${fx(g)}%）`,
    });
    if (g < 0) {
      stance = "against";
      level = "机构预期次年下滑";
    } else {
      // 档位词里**不放那个百分比**：低基数下它会是 +668%，摆在档位的位置上像个判断，
      // 其实只是分母小。数字留在依据里，档位只说「有覆盖、预期为正、但没有对照系」。
      stance = "flat";
      level = "预期为正 · 无历史对照";
    }
  } else {
    stance = "unknown";
    level = "有覆盖 · 预期未量化";
  }

  // 分歧：中性 + 未披露占了三分之一以上，说明卖方自己没形成共识——这是反方信息。
  const undisclosed = Math.max(0, c.orgNum - rated);
  const dissent = (c.neutral + undisclosed) / c.orgNum;
  if (dissent >= 0.34) {
    basis.push({
      text: `${Math.round(dissent * 100)}% 的覆盖机构给的是中性或未披露评级，卖方内部并未形成共识`,
    });
    if (stance === "flat") {
      stance = "against";
      level = "机构分歧较大";
    }
  }

  return {
    key: "valuation",
    name: "估值与预期",
    stance,
    level,
    basis,
    missing:
      stance === "unknown"
        ? "机构给了覆盖但没有可比的两年 EPS 预期"
        : "库里只有一致预期的当前快照、没有历史，因此判断不了它是被上修还是下修；" +
          "当前股价贵不贵也不在这里判断，PE 与历史分位见下方「估值对照」",
    asOf: c.asOf ? `一致预期 as-of ${ymd(c.asOf)}` : null,
  };
}

// ---------------------------------------------------------------------------
// 模型 ③：事件
// ---------------------------------------------------------------------------

/**
 * 事件模型吃的是**治理 / 外部 / 预期**三族的命题（股权、回购、增持减持、重组、政策、监管），
 * 与基本面模型的**经营族**按维度族**互斥**——这不是洁癖：冒烟第一版里两个模型并排显示了
 * 同样三条回购证据，看着像两份独立判断，其实是同一件事被数了两遍。
 * 「五个模型」如果只是把同一池信号切五刀，一致性就永远是满分，等于没有信息。
 */
function eventModel(input: DecisionInput, now: Date): ModelRead {
  const sigs = input.signals.filter(
    (s) =>
      watched(input, s) &&
      within(s.publishedAt, now, RECENT_DAYS) &&
      dimensionFamily(s.dimensionKey) !== "operating",
  );
  const bull = sigs.filter((s) => s.direction === "bull");
  const bear = sigs.filter((s) => s.direction === "bear");

  const recentEvents = input.events.filter((e) =>
    within(e.publishedAt, now, RECENT_DAYS),
  );
  const primary = recentEvents.filter(
    (e) => e.tier === "PRIMARY" && !MICROSTRUCTURE_EVENTS.has(e.eventType),
  );

  const basis: ModelBasis[] = [];
  for (const s of bestPerDimension(sigs).slice(0, 3)) basis.push(basisOf(s));
  for (const e of primary.slice(0, 2)) {
    if (basis.some((b) => b.newsId === e.newsId)) continue;
    basis.push({
      text: `${ymd(e.publishedAt)}「${e.title}」（${e.eventType}）`,
      newsId: e.newsId,
    });
    if (basis.length >= 4) break;
  }

  if (sigs.length === 0 && recentEvents.length === 0)
    return {
      key: "event",
      name: "事件",
      stance: "flat",
      level: "无新增",
      basis: [],
      missing:
        input.dropped && input.dropped > 0
          ? `近 ${RECENT_DAYS} 天有 ${input.dropped} 条动态触及命题但未达证据标准（通用推测 / 券商观点 / 与命题对不上），已滤除`
          : null,
      asOf: `近 ${RECENT_DAYS} 天`,
    };

  let stance: ModelStance;
  let level: string;
  if (bull.length > 0 && bear.length > 0) {
    stance = "flat";
    level = "多空并存";
  } else if (bull.length >= 3) {
    stance = "support";
    level = "明显增强";
  } else if (bull.length >= 1) {
    stance = "support";
    level = "小幅增强";
  } else if (bear.length >= 1) {
    stance = "against";
    level = "转弱";
  } else {
    // 有事件但没有一条打到命题上——这本身就是有用的信息：市场在动，但和你盯的逻辑无关。
    const pol = recentEvents.reduce(
      (a, e) => a + (EVENT_POLARITY[e.eventType] ?? 0),
      0,
    );
    stance = "flat";
    level = recentEvents.length > 0 ? "未触及命题" : "无新增";
    if (recentEvents.length > 0)
      basis.push({
        text:
          `近 ${RECENT_DAYS} 天 ${recentEvents.length} 条结构化事件` +
          (pol !== 0 ? `，体裁上偏${pol > 0 ? "正面" : "负面"}` : "") +
          "，但都没有打到你盯的命题上",
      });
  }

  return {
    key: "event",
    name: "事件",
    stance,
    level,
    basis,
    missing: null,
    asOf: `近 ${RECENT_DAYS} 天 · 命中命题 ${sigs.length} 条 / 结构化事件 ${recentEvents.length} 条`,
  };
}

// ---------------------------------------------------------------------------
// 模型 ④：趋势与资金
// ---------------------------------------------------------------------------

/**
 * 用**涨跌幅连乘**造一条合成指数再算均线，不直接用收盘价。
 * 新浪给的 `close` 是未复权价，6~7 月分红旺季里实测 21% 的股票会出现除息缺口——
 * 拿它比均线会把「分红 1 元」读成「跌破均线」（`radar/series.ts` 里同一个理由）。
 */
function synthIndex(bars: RadarBar[]): number[] {
  const out: number[] = [];
  let acc = 100;
  for (const b of bars) {
    acc *= 1 + b.changePct / 100;
    out.push(acc);
  }
  return out;
}

function trendModel(input: DecisionInput): ModelRead {
  const bars = input.bars;
  if (bars.length < MIN_BARS)
    return {
      key: "trend",
      name: "趋势与资金",
      stance: "unknown",
      level: "数据不足",
      basis: [],
      missing: `只有 ${bars.length} 根日线，不足 ${MIN_BARS} 根，不给方向`,
      asOf: null,
    };

  const last = bars[bars.length - 1]!;
  const idx = synthIndex(bars);
  const r20 = returnOverDays(bars, 20);
  const maWindow = Math.min(60, idx.length);
  const ma = mean(idx.slice(-maWindow));
  const cur = idx[idx.length - 1]!;
  const flow20 = netFlowSum(bars, 20);
  const flow5 = netFlowSum(bars, 5);
  const posDays = positiveFlowDays(bars, 20);

  // 三票制：动量 / 均线位置 / 资金。任何一项缺数据就弃权（记 0），不拿缺失当负分。
  let votes = 0;
  const basis: ModelBasis[] = [];

  if (r20 !== null) {
    votes += r20 > 3 ? 1 : r20 < -3 ? -1 : 0;
    basis.push({ text: `近 20 个交易日累计 ${r20 >= 0 ? "+" : ""}${fx(r20)}%` });
  }
  if (ma !== null) {
    const gap = ((cur - ma) / ma) * 100;
    votes += gap > 1 ? 1 : gap < -1 ? -1 : 0;
    basis.push({
      text: `除权调整后收盘位于 ${maWindow} 日均线${gap >= 0 ? "上方" : "下方"} ${fx(Math.abs(gap))}%`,
    });
  }
  if (flow20 !== null) {
    votes += flow20 > 0 ? 1 : -1;
    basis.push({
      text: `主力资金近 20 日合计净${flow20 >= 0 ? "流入" : "流出"} ${money(Math.abs(flow20))}（其中 ${posDays} 天为净流入）`,
    });
  }
  if (flow5 !== null)
    basis.push({
      text: `近 5 日净${flow5 >= 0 ? "流入" : "流出"} ${money(Math.abs(flow5))}`,
    });

  const stance: ModelStance =
    votes >= 2 ? "support" : votes <= -2 ? "against" : "flat";
  const level =
    votes >= 2 ? "正在强化" : votes <= -2 ? "正在走弱" : "方向不明确";

  return {
    key: "trend",
    name: "趋势与资金",
    stance,
    level,
    basis,
    missing: null,
    asOf: `行情与资金 as-of ${last.day}（主力净额为分档估算口径，非交易所披露）`,
  };
}

// ---------------------------------------------------------------------------
// 模型 ⑤：风险
// ---------------------------------------------------------------------------

function riskModel(input: DecisionInput, now: Date): ModelRead {
  const basis: ModelBasis[] = [];
  let points = 0;

  const bear = input.signals.filter(
    (s) =>
      watched(input, s) &&
      s.direction === "bear" &&
      within(s.publishedAt, now, OPERATING_DAYS),
  );
  if (bear.length > 0) {
    points += bear.length >= 2 ? 2 : 1;
    for (const s of bear.sort((a, b) => b.materiality - a.materiality).slice(0, 2))
      basis.push(basisOf(s));
  }

  const riskEvents = input.events.filter(
    (e) => RISK_EVENTS.has(e.eventType) && within(e.publishedAt, now, OPERATING_DAYS),
  );
  if (riskEvents.length > 0) {
    points += riskEvents.length >= 3 ? 2 : 1;
    const byType = new Map<string, number>();
    for (const e of riskEvents)
      byType.set(e.eventType, (byType.get(e.eventType) ?? 0) + 1);
    basis.push({
      text:
        `近 ${OPERATING_DAYS} 天 ${riskEvents.length} 条需复核体裁的公告：` +
        [...byType].map(([k, v]) => `${k} ${v}`).join("、"),
      newsId: riskEvents[0]!.newsId,
    });
  }

  const u = input.unlock;
  if (u) {
    const d = (new Date(u.freeDate).getTime() - now.getTime()) / 86_400_000;
    if (d >= -7 && d <= 90) {
      points += u.ratio >= 3 ? 2 : 1;
      basis.push({
        text: `${u.freeDate} 有 ${fx(u.ratio)}% 流通股解禁（${u.type}）`,
      });
    }
  }

  if (input.margin)
    basis.push({
      text: `融资余额 ${money(input.margin.rzye)}，占流通市值 ${fx(input.margin.zb)}%`,
    });

  if (basis.length === 0)
    return {
      key: "risk",
      name: "风险",
      stance: "unknown",
      level: "数据不足",
      basis: [],
      missing: `近 ${OPERATING_DAYS} 天没有采到偏恶化的信号、需复核体裁的公告或解禁安排`,
      asOf: null,
    };

  // 风险模型只可能是 against 或 flat：**没有风险不等于利好**。
  // 把「暂未发现风险」记成支持票，会让一只没人写公告的冷门股拿到一票凭空的正面。
  const stance: ModelStance = points >= 2 ? "against" : "flat";
  const level = points >= 3 ? "中高" : points >= 2 ? "偏高" : points >= 1 ? "中性" : "暂未发现";

  return {
    key: "risk",
    name: "风险",
    stance,
    level,
    basis,
    missing: null,
    asOf: `反方证据 · 近 ${OPERATING_DAYS} 天`,
  };
}

// ---------------------------------------------------------------------------
// 条件完成度
// ---------------------------------------------------------------------------

/**
 * 「系统只告诉他『你的条件满足了几个』，不替他生成条件」——所以这里的条目**全部**来自
 * 用户自己：他勾的维度、他设的价位。解牛一条都不添。
 */
function buildConditions(input: DecisionInput, now: Date) {
  const items: ConditionItem[] = [];
  const active = input.dims.filter((d) => !d.muted);

  for (const d of active) {
    const mine = input.signals.filter(
      (s) =>
        s.dimensionKey === d.key &&
        s.materiality >= threshold(input.dims, d.key) &&
        within(s.publishedAt, now, OPERATING_DAYS),
    );
    const bear = mine
      .filter((s) => s.direction === "bear")
      .sort((a, b) => toTime(b.publishedAt) - toTime(a.publishedAt))[0];
    const bull = mine
      .filter((s) => s.direction === "bull")
      .sort((a, b) => toTime(b.publishedAt) - toTime(a.publishedAt))[0];

    // 恶化优先于满足：同一维度上既有兑现又有恶化时，需要用户看到的是那条反面证据。
    if (bear)
      items.push({
        label: d.watch || d.key,
        state: "adverse",
        detail: bear.fact,
        newsId: bear.newsId ?? undefined,
        fresh: within(bear.publishedAt, now, NEWLY_MET_DAYS),
        priority: d.priority,
      });
    else if (bull)
      items.push({
        label: d.watch || d.key,
        state: "met",
        detail: bull.fact,
        newsId: bull.newsId ?? undefined,
        fresh: within(bull.publishedAt, now, NEWLY_MET_DAYS),
        priority: d.priority,
      });
    else
      items.push({
        label: d.watch || d.key,
        state: "pending",
        detail: `近 ${OPERATING_DAYS} 天没有达到你这条敏感度门槛的可核事实`,
        fresh: false,
        priority: d.priority,
      });
  }

  for (const a of input.alerts) {
    const triggered =
      !a.active && a.triggeredAt != null && within(a.triggeredAt, now, TRIGGER_DAYS);
    if (!a.active && !triggered) continue; // 早已触发过又没重开的，不占条目
    items.push({
      label: a.label ?? "价格观察位",
      state: triggered ? "met" : "pending",
      detail: triggered
        ? `${ymd(a.triggeredAt!)} 价格进入你设定的观察区间（这是价格事实，不代表逻辑被验证）`
        : "价格尚未进入你设定的观察区间",
      fresh: triggered,
      priority: false,
    });
  }

  items.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    const rank = { adverse: 0, met: 1, pending: 2 } as const;
    return rank[a.state] - rank[b.state];
  });

  const met = items.filter((i) => i.state === "met").length;
  return {
    met,
    total: items.length,
    freshlyMet: items.filter((i) => i.state === "met" && i.fresh).length,
    items,
    unset: input.dims.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

const VERDICT_LABEL: Record<CardVerdict, string> = {
  strengthen_strong: "逻辑明显增强",
  strengthen_mild: "逻辑小幅增强",
  no_change: "暂无实质变化",
  conflict: "多空证据冲突",
  weaken: "逻辑出现削弱",
  broken: "核心逻辑可能被破坏",
  insufficient: "数据不足，无法判断",
};

export function buildDecisionCard(input: DecisionInput): DecisionCard {
  const now = input.now ?? new Date();

  const models: ModelRead[] = [
    fundamentalModel(input, now),
    valuationModel(input),
    eventModel(input, now),
    trendModel(input),
    riskModel(input, now),
  ];

  const support = models.filter((m) => m.stance === "support").length;
  const against = models.filter((m) => m.stance === "against").length;
  const flat = models.filter((m) => m.stance === "flat").length;
  const unknown = models.filter((m) => m.stance === "unknown").length;
  const net = support - against;

  /**
   * 「核心逻辑可能被破坏」是这七档里最重的一句，门槛必须最高：
   * 一条**一手**（direct）偏恶化的证据，打在用户**正在监控**的维度上，
   * 且基本面与风险两个模型同时给出反方读数。三项缺一就降到「削弱」。
   *
   * 第一版写的是「打在用户标为**重点**的维度上」——真实数据里 `priority=true` 是
   * **0/134**（没有一个用户标过重点），也就是说那一版的这个分支永远不会触发。
   * 一个永远为假的判据比没有更糟：它让人以为最严重的那档有人在守。
   */
  const activeKeys = new Set(
    input.dims.filter((d) => !d.muted).map((d) => d.key),
  );
  const brokenHit = input.signals.find(
    (s) =>
      s.direction === "bear" &&
      s.grade === "direct" &&
      // 材料度顶档才算「可能破坏核心逻辑」。全库 511 条信号里 ≥80 的只有 26 条（5%），
      // 用 60 档（317 条）会让这一档变成常见结论，最重的那句话就不值钱了。
      s.materiality >= 80 &&
      (activeKeys.size === 0 || activeKeys.has(s.dimensionKey)) &&
      within(s.publishedAt, now, RECENT_DAYS),
  );
  const brokenModels =
    models.find((m) => m.key === "fundamental")!.stance === "against" &&
    models.find((m) => m.key === "risk")!.stance === "against";

  let verdict: CardVerdict;
  if (unknown >= 3) verdict = "insufficient";
  else if (brokenHit && brokenModels) verdict = "broken";
  else if (support >= 1 && against >= 1 && Math.abs(net) <= 1)
    verdict = "conflict";
  else if (net <= -2 || (against >= 1 && support === 0)) verdict = "weaken";
  else if (net >= 3) verdict = "strengthen_strong";
  else if (net >= 1) verdict = "strengthen_mild";
  else verdict = "no_change";

  // 一致性：**只在有明确方向的模型里数**，并且明写它不是涨跌概率。
  const directional = support + against;
  const same = Math.max(support, against);
  const agreement = {
    same,
    total: models.length,
    note:
      directional === 0
        ? "没有模型给出方向"
        : `${directional} 个模型有明确方向，其中 ${same} 个指向同一侧`,
  };

  const conditions = buildConditions(input, now);

  /**
   * 最重要的新增证据：近 30 天里 direct 档优先 → **带数字的优先** → 再按材料度。
   * 没有就是没有，不拿旧的凑。
   *
   * 「带数字」这一档是真机截图逼出来的：澜起科技这一格原本显示「公司回购金额较大，
   * 显示现金流状况良好」——同一批信号里明明有「累计回购 70.5 万股、支付 1.44 亿元」。
   * 前者是形容词，后者是可核查的事实，而这一格是整张卡最显眼的一句话。
   * 同一个判据在复盘的「事实锚点」那轮已经用过：一句话换一天还成立，就不是证据。
   */
  const hasNumber = (t: string) => /\d/.test(t);
  const fresh = input.signals
    .filter((s) => watched(input, s) && within(s.publishedAt, now, RECENT_DAYS))
    .sort((a, b) => {
      const ga = a.grade === "direct" ? 1 : 0;
      const gb = b.grade === "direct" ? 1 : 0;
      if (ga !== gb) return gb - ga;
      const na = hasNumber(a.fact) ? 1 : 0;
      const nb = hasNumber(b.fact) ? 1 : 0;
      if (na !== nb) return nb - na;
      return b.materiality - a.materiality;
    })[0];
  const topEvidence = fresh ? basisOf(fresh) : null;

  // 最大的不确定性：优先报「哪个模型没料」，其次报重点维度里还没兑现的那条。
  const firstUnknown = models.find((m) => m.stance === "unknown");
  const pendingPriority = conditions.items.find(
    (i) => i.state === "pending" && i.priority,
  );
  const pendingAny = conditions.items.find((i) => i.state === "pending");
  const topUncertainty = firstUnknown?.missing
    ? `${firstUnknown.name}：${firstUnknown.missing}`
    : (pendingPriority ?? pendingAny)
      ? `你的条件「${(pendingPriority ?? pendingAny)!.label}」仍未满足`
      : null;

  const tally =
    `5 个模型中 ${support} 项改善、${against} 项走弱、${flat} 项未变化、${unknown} 项待确认` +
    (conditions.unset
      ? ""
      : `；你的 ${conditions.total} 项条件已满足 ${conditions.met} 项`);

  const headline = buildHeadline(verdict, models, conditions);
  const body = buildBody(verdict, models, input, conditions);

  return {
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    headline,
    tally,
    body,
    models,
    agreement,
    conditions,
    topEvidence,
    topUncertainty,
  };
}

/**
 * hero 大标题：一句完整的话，**必须落到具体模型上**。
 * 「当前偏正面」这种换一天也成立的说法一律不许出现（复盘去废话那轮的判据）。
 */
function buildHeadline(
  verdict: CardVerdict,
  models: ModelRead[],
  conditions: ReturnType<typeof buildConditions>,
): string {
  const names = (st: ModelStance) =>
    models.filter((m) => m.stance === st).map((m) => m.name);
  const sup = names("support");
  const ag = names("against");
  const unk = names("unknown");

  switch (verdict) {
    case "strengthen_strong":
      return `${sup.join("、")}同时改善，逻辑明显增强。`;
    case "strengthen_mild":
      return `${sup.join("、")}改善，其余模型没有同步变化，尚未形成高确定性。`;
    case "conflict":
      return `${sup.join("、")}在改善，${ag.join("、")}同时走弱——证据互相矛盾，解牛不替你调和。`;
    case "weaken":
      return `${ag.join("、")}出现走弱，没有其他模型给出相反的证据。`;
    case "broken":
      return "你监控的命题上出现了一手的反面证据，核心逻辑可能已被破坏。";
    case "insufficient":
      return `五个模型里有 ${unk.length} 个没有可核数据（${unk.join("、")}），这只股现在判不了。`;
    default:
      return conditions.unset
        ? "五个模型都没有出现方向性变化。"
        : `五个模型都没有出现方向性变化，你的 ${conditions.total} 项条件里满足 ${conditions.met} 项。`;
  }
}

function buildBody(
  verdict: CardVerdict,
  models: ModelRead[],
  input: DecisionInput,
  conditions: ReturnType<typeof buildConditions>,
): string {
  // 「数据不足」优先于「你还没写逻辑」：两件事都成立时，先说清哪个模型没料——
  // 这是**这只股**的客观状况，不写逻辑也改变不了它；写逻辑的邀请跟在后面。
  if (verdict === "insufficient") {
    const unk = models.filter((m) => m.stance === "unknown");
    return (
      unk.map((m) => `${m.name}：${m.missing}`).join("；") +
      "。解牛宁可说不知道，也不拿推测补位。" +
      (conditions.unset ? " 写下你自己的逻辑后，解牛还会替你盯这几条命题有没有被验证。" : "")
    );
  }
  if (conditions.unset)
    return (
      "下面五个模型用的是公开数据，与你无关。写下「我为什么关注它」并勾出要盯的维度后，" +
      "解牛才能把每条动态对照你自己的命题来判断，并告诉你条件满足了几项。"
    );
  // 这段在手机上原本要占五行。「不把价格翻译成买卖动作 / 不把同概念写成直接受益」
  // 卡底的免责已经写过一遍，这里删掉重复的那半句，只留这张卡**独有**的两件事：
  // 每条都能点回出处、冲突不调和。
  const dropped = input.dropped ?? 0;
  return (
    "每一项都能点回原始出处；五个模型分开摆，冲突时不替你调和。" +
    (dropped > 0
      ? ` 另有 ${dropped} 条动态触及这些命题但未达证据标准，已滤除。`
      : "")
  );
}
