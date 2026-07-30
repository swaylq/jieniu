// 证据标准（张楚寒 2026-07-30 反馈）。相对导入、无 IO、可测。
//
// 反馈原话：「我更想指出一个比『能不能点』更严重的问题：现在这些『最新证据』很多并不是真正的
// 证据，和投资命题也没有完全对应上。」他圈出的三条，正好是三种不同的坏形状：
//
//   | 投资命题 | 当前所谓证据                    | 实际问题                                   |
//   | 行业景气 | 研报强调公司GPU领军地位          | 只能证明券商看好公司地位，不能证明行业需求增强 |
//   | 公司治理 | 重大资产重组「通常」涉及战略调整   | 是通用推测，不是摩尔线程发生了什么           |
//   | 毛利率   | 净利润预增「可能」反映毛利率改善   | 净利润也可能来自收入增长、费用下降或非经常损益 |
//
// 三条对应三个机械判据：
//   ① **观点 ≠ 事实**：研报 / 评级 / 分析师看好，只能验证「市场预期」类命题，
//      不能验证「行业景气 / 毛利率 / 订单」这类经营事实类命题。
//   ② **通用推测**：「X 通常涉及 Y，可能带来 Z」——换一家公司照样成立，就不是证据
//      （与 `digest-substance` 那条「换一天还成立吗」是同一把尺子，只是换了个轴：换一家公司还成立吗）。
//   ③ **指标替代**：拿净利润去证毛利率。命题盯的是哪个指标，证据就得出现那个指标。
//
// 判废后**宁可留空**——「最新证据」那一行空着，比顶一句通用推测更诚实（同 parseDigestResponse 的立场）。
// 每条判废都带 `reason` 且可统计：兜底/降级机制必须可观测，否则会把上游 bug 伪装成「今天没料」
// （见 lessons.md「相关性评分的绝对门槛跨层不可比」那条）。

import { hasFactAnchor } from "./digest-substance";
import { ROUNDUP_TITLE } from "./relevance";

/** direct=本公司的可核查事实；supporting=同业/上游/外部事实（旁证）；inference=推测，不展示。 */
export type EvidenceGrade = "direct" | "supporting" | "inference";

export type EvidenceInput = {
  /** 客观事实：这条资讯里**已经发生**的可核查陈述。 */
  fact: string;
  /** 为什么这条事实能验证该命题（含局限）。判据不看它，但抽屉要展示。 */
  why: string;
  dimensionKey: string;
  /** 本实体名（判「是不是这家公司发生的事」）。 */
  subject: string;
  newsTitle: string;
  /** PRIMARY=一手（公司公告/交易所），其余为媒体。 */
  tier: string;
};

export type EvidenceVerdict = {
  ok: boolean;
  grade: EvidenceGrade;
  reason: string;
};

// ---------------------------------------------------------------------------
// ① 通用推测：换一家公司照样成立
// ---------------------------------------------------------------------------

/**
 * 「通常 / 一般来说 / 往往」单独出现就是通论——它在讲一类事情的规律，不在讲这家公司。
 * 注意 `预计 / 可能` **不在**这一档：A 股业绩预告的标准句式就是「预计净利润同比增长60%-80%」，
 * 那是公司自己披露的事实，不是我们的推演。
 */
const GENERIC_ALONE = /通常|一般来说|一般而言|往往|多数情况下|按惯例|理论上|普遍认为|大概率/;

const HEDGE = "(?:可能|或将|有望|预计|通常|一般|往往|多数情况下|理论上|按惯例|间接|料将|应会)";
const INFER_VERB =
  "(?:反映|表明|意味|说明|带来|支撑|传递|影响|利好|利空|用于|涉及|提供|体现|预示|推动|巩固|增强|提升|改善|加强|优化|扩大|加速|提振|受益|引发|加剧|缓解|催化|完善|拓展)";
/** 「可能为…提供资金支持」「间接支撑…预期」：模糊连词 + 推演动词 = 我们在替公司想象。 */
const HEDGED_INFERENCE = new RegExp(`${HEDGE}[^，。；,;]{0,16}${INFER_VERB}`);

/** 「有助于 / 有利于」本身就是推演连词，不用等后面接什么动词。 */
const BARE_HEDGE_LINK = /有助于|有利于|或有望|不排除/;

/**
 * 「显示 / 传递 / 彰显 + 抽象名词」——「实控人增持，显示对公司长期发展的信心」。
 * 前半句是事实，后半句是**表态式套话**：任何一次增持回购都能这么写，它不增加任何可核查信息。
 * 注意别误伤转述（「半年报显示营收增长62%」）——所以只在宾语是抽象评价词时才命中。
 */
const STANCE_BOILERPLATE =
  /(显示|彰显|体现|传递|释放|表达)[^，。；,;]{0,12}(信心|决心|信号|意愿|态度|预期|重视|承诺|积极|向好|稳定|充裕|实力|优势|潜力|重视程度)/;

/** 「对市场活跃度影响有限」——是编辑口吻的判断，不是事实。 */
const EDITORIAL_VERDICT = /影响(有限|不大|可控|中性)|(整体|基本)可控/;

/**
 * **自认没有内容**的「证据」：「股东会决议公告涉及公司治理，但未披露具体内容」。
 * 它承认自己什么都没说，却仍然占着「最新证据」那一行——这是最典型的正确的废话。
 *
 * 只在**同时没有任何数字**时才判废：真事实也常带这类限定
 * （「拟回购3亿元-6亿元，未披露资金来源」），那种带着数字的限定是诚实，不是空洞。
 */
const SELF_ADMITTED_EMPTY =
  /未(披露|提及|说明|给出|公布|涉及)(具体)?(内容|细节|数据|金额|信息)|无具体(内容|细节|数据|信息)|方向不明|具体(内容|情况)(未|不)详/;
const NUMERIC = /\d/;

export function isGenericSpeculation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    GENERIC_ALONE.test(t) ||
    HEDGED_INFERENCE.test(t) ||
    BARE_HEDGE_LINK.test(t) ||
    STANCE_BOILERPLATE.test(t) ||
    EDITORIAL_VERDICT.test(t) ||
    (SELF_ADMITTED_EMPTY.test(t) && !NUMERIC.test(t))
  );
}

// ---------------------------------------------------------------------------
// ② 推测链：由一件事推演出另一件事
// ---------------------------------------------------------------------------

/**
 * 「营收大幅增长**表明**AI计算市场需求强劲」——没有任何模糊词，但仍然是推演：
 * 前半句是事实，后半句是我们加上去的结论，而后半句才是它声称验证的那个命题。
 * 注意排除「报告**显示**营收增长」这类**转述**（显示的是原文内容，不是我们的推理）。
 */
const INFER_LINK = /反映出?|表明|意味着|说明了?|预示|折射出?|暗示|印证了?|证明了?/;

export function isInferenceChain(text: string): boolean {
  return INFER_LINK.test(text.trim());
}

// ---------------------------------------------------------------------------
// ③ 观点 ≠ 事实
// ---------------------------------------------------------------------------

const OPINION =
  /研报|研究报告|券商.{0,6}(认为|看好|指出|覆盖)|分析师|机构(认为|看好|指出)|维持.{0,6}(买入|增持|推荐|持有|中性|跑赢|优于)评级|首次覆盖|给予.{0,6}评级|目标价|评级(上调|下调)|强调.{0,10}(地位|优势|前景|实力)|看好/;

export function isOpinionSource(text: string): boolean {
  return OPINION.test(text.trim());
}

// ---------------------------------------------------------------------------
// 命题分类：什么样的证据才算数，取决于命题盯的是什么
// ---------------------------------------------------------------------------

export type DimensionFamily = "operating" | "governance" | "external" | "expectation";

const EXPECTATION = /估值|预期|情绪|评级|关注度|市值|共识|分歧|机构持仓|资金面/;
const GOVERNANCE =
  /治理|股权|管理层|实控|控股股东|董事|高管|回购|增持|减持|重组|并购|分红|股权激励|承诺/;
const EXTERNAL = /政策|监管|补贴|关税|汇率|宏观|合规|准入|标准制定|地缘/;
const OPERATING =
  /景气|需求|订单|客户|产能|产量|出货|交付|毛利|净利|利润|盈利|收入|营收|成本|费用|价格|售价|份额|扩产|库存|良率|技术|研发|产品|业务|经营|财务|竞争力|市场扩展|渠道|产业链/;

/** 命题属于哪一族。分不出来时按 operating 兜底——那是最严的一档，宁严勿滥。 */
export function dimensionFamily(key: string): DimensionFamily {
  const k = key.trim();
  if (EXPECTATION.test(k)) return "expectation";
  if (GOVERNANCE.test(k)) return "governance";
  if (EXTERNAL.test(k)) return "external";
  if (OPERATING.test(k)) return "operating";
  return "operating";
}

/**
 * 指标替代：命题盯着某个指标，证据里就必须出现那个指标（或它的直接构成项）。
 * 张楚寒圈的第三条就是这个形状——「净利润预增可能反映毛利率改善」，而净利润也可能
 * 来自收入增长、费用下降或非经常损益。
 *
 * **只写有把握的几条**。手写词表只能用来择优、不能静默删除，所以每条判废都会带上
 * 具体理由（下方 judgeEvidence 把它塞进 reason，脚本/抽屉都能看见）。
 */
const METRIC_REQUIRED: { dim: RegExp; need: RegExp; why: string }[] = [
  {
    dim: /毛利/,
    need: /毛利|成本|售价|单价|价格|费用率|单位.{0,4}(成本|价)/,
    why: "净利润/收入不能单独证明毛利率——也可能来自收入增长、费用下降或非经常损益",
  },
  {
    dim: /产能|扩产|资本开支/,
    need: /产能|产线|扩产|投产|量产|开工|建设|投资额|资本开支|设备|工厂|基地|良率/,
    why: "证据里没有产能/在建/投产的具体事实，无法验证产能类命题",
  },
  {
    dim: /订单|大客户|客户结构/,
    need: /订单|中标|合同|框架协议|客户|供货|定点|交付|采购|签约|导入/,
    why: "证据里没有订单/客户的具体事实，无法验证订单类命题",
  },
  {
    dim: /份额|定价|价格|渗透率/,
    need: /份额|占有率|市占|定价|价格|涨价|降价|提价|均价|单价|出货|销量|渗透率|供需/,
    why: "证据里没有份额/价格的具体数据，无法验证份额与定价类命题",
  },
  {
    dim: /现金流|资本开支/,
    need: /现金|回购|分红|经营性|自由现金|资本开支|投资额|募投|货币资金|支付|融资/,
    why: "证据里没有现金/资本开支的具体数据，无法验证现金流类命题",
  },
];

// ---------------------------------------------------------------------------
// 综述体裁：主体不是这家公司
// ---------------------------------------------------------------------------

/**
 * 「新华财经早报：7月30日」里确实写着「西部矿业营收净利显著增长」，但把它当成西部矿业的
 * 「最新证据」是错的——那是一篇罗列几十家公司的稿子，真正的一手信息在别处。
 * 既有的 `ROUNDUP_TITLE` 是为「入库时剥离绑定」设的，不含早报/汇总这一档，这里补上。
 */
const DIGEST_GENRE =
  /早报|早参|晚报|夜读|午报|快报汇总|汇总|精选|盘点|一览|速览|简讯|摘要|要闻|风口研报|投资早参|财经早餐|盘前|收盘播报/;

export function isRoundupGenre(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  return DIGEST_GENRE.test(t) || ROUNDUP_TITLE.test(t);
}

// ---------------------------------------------------------------------------
// 主判据
// ---------------------------------------------------------------------------

/** 「贵州茅台(600519)」→「贵州茅台」；证据文本里模型不会带代码后缀。 */
function cleanName(name: string): string {
  return name.replace(/\(\d{4,6}\)\s*$/, "").replace(/-U$/, "").trim();
}

const MIN_FACT_LEN = 8;

/**
 * 这条「证据」够不够格挂在这个命题下面。
 * 顺序有意为之：先排掉**根本不是事实**的（空/综述/通论/推演/观点），再看**对不对得上命题**
 * （指标替代），最后才看有没有锚点。这样 reason 报的是最根本的那个原因，不是最后一道。
 */
export function judgeEvidence(i: EvidenceInput): EvidenceVerdict {
  const fact = i.fact.trim();
  const no = (reason: string): EvidenceVerdict => ({
    ok: false,
    grade: "inference",
    reason,
  });

  if (fact.length < MIN_FACT_LEN) return no("证据为空或过短");
  // 「是什么东西」比「怎么写的」更根本：一条券商观点无论措辞多硬，都证不了经营事实，
  // 所以观点判据排在措辞类判据（通论/推演）前面——reason 要报最根本的那个原因。
  const family = dimensionFamily(i.dimensionKey);
  if (isOpinionSource(fact) && family !== "expectation") {
    return no("券商观点只能验证「市场预期」类命题，不能证明经营/治理事实");
  }

  if (isGenericSpeculation(fact)) {
    return no("通用推测——换一家公司照样成立，不是这家公司发生了什么");
  }
  if (isInferenceChain(fact)) {
    return no("推测链——由一件事推演出另一件事，不是可核查的事实本身");
  }

  const name = cleanName(i.subject);
  const namesSubject = name.length >= 2 && fact.includes(name);
  const roundup = isRoundupGenre(i.newsTitle);
  // 综述体裁（早报 / 榜单 / 研报汇总）**不是一律判废**——第一版这么做，实测把
  // 「国务院批复《扩大消费十五五规划》」这类真·政策事实整批误杀（挡掉的 272 条里 28 条是它）。
  // 真正要挡的是「早报里提到**别家公司**的事，被当成这家公司的最新证据」。判据因此收窄成：
  // 既没点到这家公司、命题又属于需要公司自有事实的那一类（经营 / 治理）→ 才废。
  // 政策这类外部命题，宏观事实本来就是合法旁证；留下的一律封顶 supporting——它终究是二手。
  if (roundup && !namesSubject && (family === "operating" || family === "governance")) {
    return no("来自综述体裁（早报/汇总/榜单），且证据没有指向这家公司");
  }

  // 一个命题常同时盯多个指标（「现金流与资本开支」「内存接口芯片份额与定价」），
  // 所以判据是**满足其中任意一族即可**，不是每族都要满足。
  // 第一版写成「逐族否决」，实测把「回购 1.03 亿」判进了「现金流与资本开支」的产能族里，
  // 理由打出来是「没有产能/在建/投产的事实」——命题的另一半明明说的就是现金。
  const families = METRIC_REQUIRED.filter((r) => r.dim.test(i.dimensionKey));
  if (families.length > 0 && !families.some((r) => r.need.test(fact))) {
    return no(families[0]!.why);
  }

  if (!hasFactAnchor(fact)) {
    return no("没有可核查的事实锚点（数字 / 具名主体 / 具体事件）");
  }

  // 主体在不在这家公司身上，决定它是直接证据还是旁证。
  // 旁证不是坏事——「SK海力士扩产」对存储链公司的行业景气命题是真·有效旁证，
  // 但用户有权知道这条不是关于他这家公司的（可信度的一半来自知道证据有多硬）。
  const direct = namesSubject && !roundup;
  return {
    ok: true,
    grade: direct ? "direct" : "supporting",
    reason: direct
      ? i.tier === "PRIMARY"
        ? "一手来源 · 本公司事实"
        : "本公司事实"
      : "外部/同业事实，可作旁证",
  };
}

const GRADE_LABEL: Record<EvidenceGrade, string> = {
  direct: "直接证据",
  supporting: "旁证",
  inference: "推测",
};

export function gradeLabel(g: EvidenceGrade): string {
  return GRADE_LABEL[g];
}

const GRADES = new Set<string>(["direct", "supporting", "inference"]);

/** 库里一行 ThesisSignal 的证据相关字段（旧行 fact/why/grade 为 null）。 */
export type StoredSignal = {
  dimensionKey: string;
  note: string;
  fact?: string | null;
  why?: string | null;
  grade?: string | null;
  newsTitle: string;
  tier?: string | null;
};

/**
 * 一行库记录够不够格当「证据」展示。
 *
 * 写入时已判过的（`grade` 有值）直接采信，不重复算；**旧行现判一次**——这样存量 395 条
 * 不用等回填就立刻按新标准过滤。这一点是有意的：判废是给用户看的效果，回填是给数据的效果，
 * 两者不该互相等待（等回填意味着这几天用户还在看假证据）。
 */
export function qualifyStoredSignal(
  s: StoredSignal,
  subject: string,
): EvidenceVerdict {
  if (s.grade && GRADES.has(s.grade)) {
    const grade = s.grade as EvidenceGrade;
    return {
      ok: grade !== "inference",
      grade,
      reason: grade === "inference" ? "写入时已判为推测" : "写入时已通过证据判据",
    };
  }
  return judgeEvidence({
    fact: s.fact ?? s.note,
    why: s.why ?? "",
    dimensionKey: s.dimensionKey,
    subject,
    newsTitle: s.newsTitle,
    tier: s.tier ?? "MEDIA",
  });
}

export type QualifiedEvidence<T> = { item: T; verdict: EvidenceVerdict };

/**
 * 批量过滤。**必须能回答「丢了多少、为什么」**——静默丢弃会把上游 bug（提示词坏了、
 * 分类器不出货）伪装成「这只股今天没料」，那正是我们反复栽的那个坑。
 */
export function keepQualified<T extends EvidenceInput>(
  items: T[],
): { kept: QualifiedEvidence<T>[]; dropped: QualifiedEvidence<T>[] } {
  const kept: QualifiedEvidence<T>[] = [];
  const dropped: QualifiedEvidence<T>[] = [];
  for (const item of items) {
    const verdict = judgeEvidence(item);
    (verdict.ok ? kept : dropped).push({ item, verdict });
  }
  return { kept, dropped };
}
