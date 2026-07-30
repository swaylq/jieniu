// 市场级素材的**相关性排序**与**同主体收口**。相对导入、无 IO、可测。
//
// 2026-07-30 沙盘（sway：「还是觉得这块信息不足」，指首屏复盘的国际/国内/产业三层）。
// 诊断出来的两件事，`importance` 都解决不了：
//
//   ① `importance` 在低分档没有鉴别力——近 24h 不绑个股的 852 条里，681 条挤在 importance=30
//      这一档（未打分的默认值）。而这一档里既有「SK海力士跌逾17%」「美联储将公布重磅决议」
//      这类当天主线，也有「釜山破122年最高气温」「7305位港澳居民投保穗岁康」。
//   ② `importance` 在高分档**排错了**——importance=70 同时给了「旺宏追加158亿新台币投资扩产」
//      和「新疆通信管理局召开上半年重点工作推进会」。按 importance 取前 N，后者先到先得占位，
//      前者（当天存储链主线的一环）落选。
//
// 所以这里换一把尺子：**这条消息会不会改变某个东西的定价**。
// 会改变定价的是硬事件（产能/订单/价格/业绩/回购/货币操作/关税）、是金额、是外生主体；
// 不会改变定价的是行政通报、规范指引、民生文体、以及「A股指数今天跌了多少」这种结果复述。
//
// 铁律：**减分只降权、不硬删**（除了已有的 `isMarketLevelWorthy`）。词表一定有洞
// （见 evolution/lessons.md「归因判据别靠词表」），有洞时代价应该是「排后面」而不是「消失」。
// 唯一的硬门槛是「净分为负」——那类条目进复盘只会稀释信息密度，宁可该层给少几条。

import {
  classifyScope,
  isMarketLevelWorthy,
  type DigestScope,
  type MacroCandidate,
} from "./digest-substance";

export type RankableMacro = MacroCandidate;

// ---------------------------------------------------------------------------
// 加分项：会改变定价的东西
// ---------------------------------------------------------------------------

/**
 * 硬事件——一个**具体发生（或即将发生）的动作**，而且这个动作有价格含义。
 * 刻意不含「调研 / 上调 / 下调 / 会议」这类既能指实事、也能指行政流程的词：
 * 它们在 A 股快讯里绝大多数是后者，放进来会把行政通报捞成高分。
 */
const HARD_EVENT: RegExp[] = [
  /扩产|量产|投产|减产|停产|复产|产能|排产/,
  /订单|中标|签约|合同|交付|招标|中签/,
  /涨价|降价|提价|调价|价格(上涨|下跌|上调|下调)|涨幅达|报价/,
  /财报|业绩(预告|快报|预增|预减|预亏|扭亏|大增|下滑)?|预增|预减|扭亏|中报|半年报|年报|季报/,
  /回购|增持|减持|举牌|要约|分红|定增|配股|解禁/,
  /降准|降息|加息|逆回购|MLF|LPR|国债|存款准备金|流动性|净投放|净回笼/,
  /关税|制裁|禁令|出口管制|放宽|加征|豁免/,
  /收购|并购|重组|分拆|入股|增资|IPO|退市|复牌|停牌/,
  /熔断|涨停|跌停|创纪录|历史新高|历史新低|回调区间/,
  /决议|议息|表决|投票|反对票|通过.{0,4}(法案|方案)/,
  /(亿|万亿).{0,8}投资|投资.{0,8}(亿|万亿)|追加投资|加大投资|资助|拨款|补贴/,
  /库存|运价|CPI|PPI|PMI|GDP|非农|失业率|油价|金价|铜价|锂价|内存价格|存储价格/,
  // 统计与资金面：宏观层的「今天发生了什么」大量是数据出炉与资金流向
  /(余额|增速|成交额|投资额|产量|销量|业务量|发电量|用电量|货运量).{0,10}(同比|环比|增长|下降|下滑|达|突破)|同比(增长|下降|下滑)|环比(增长|下降|下滑)/,
  /北向资金|南向资金|外资(净)?(流入|流出|买入|卖出)|融资余额|净卖出|净买入|净流入|净流出/,
];

/**
 * 政策与规划。**这一组是补给国内宏观层的**——2026-07-30 实测：国内层 44 条候选里 41 条被
 * 6 分门槛挡下，其中「《国家应对气候变化"十五五"规划》」「央行上海总部：贷款余额同比增长5.9%」
 * 「邮政业十五五规划：2030年快递收入2万亿元」都是真·当天宏观事件。
 *
 * 根因是上面那组硬事件按**产业事件的形状**写的（扩产/订单/涨价/金额），而国内宏观的主要体裁
 * 是政策与规划，天生没有那些动词——同一把绝对门槛跨层不可比。
 *
 * 与 `ADMIN_NOISE` 不冲突：「规划发布」加分、「推进会」减分，同一条命中两边就按净分算，
 * 这正是想要的（「XX规划推进会」确实比「XX规划发布」价值低）。
 */
const POLICY_EVENT =
  /规划|纲要|指导意见|实施方案|征求意见|新规|条例|办法|细则|定调|部署|试点|扩内需|稳增长|逆周期|专项债|减税|降费|收储|限产|配额|准入|松绑|放开|开放|改革|现房销售|保交楼|城市更新/;

/** 数字 + 单位。金额、百分比、点位都算——数字是天然的反废话。 */
const NUM_ANCHOR =
  /\d+(\.\d+)?\s*(%|％|亿|万|元|美元|欧元|港元|新台币|日元|韩元|点|倍|家|只|个基点|bp|BP)/;

/** 万亿 / 千亿 级别的钱，额外加权——量级本身就是信息。 */
const BIG_MONEY = /\d+(\.\d+)?\s*(万亿|千亿)/;

/**
 * 外生主体：A 股当天最大的变量常常来自这里（隔夜美股、美联储、海外龙头、关税）。
 * 与 `digest-substance` 的 OVERSEAS 有重叠是有意的——那份用来**分层**，这份用来**加权**。
 */
const EXOGENOUS =
  /美联储|沃什|鲍威尔|白宫|特朗普|欧央行|欧洲央行|日本央行|韩国银行|OPEC|台积电|三星|SK海力士|美光|铠侠|旺宏|英伟达|AMD|英特尔|希捷|西部数据|格芯|格罗方德|微软|谷歌|Alphabet|亚马逊|苹果|特斯拉|Meta|OpenAI|ASML|阿斯麦/;

/**
 * 海外市场本身。「韩股迈向史上最大单月跌幅」不带数字、不含硬事件、主体也不是哪家公司，
 * 但它就是当天 A 股风险偏好的外生输入——单靠事件词与金额会给它 0 分，直接沉底。
 */
const OVERSEAS_MARKET =
  /美股|纳指|纳斯达克|道指|道琼斯|标普|罗素|VIX|欧股|欧洲股市|日经|韩股|韩国股市|首尔综指|台股|加权指数|港股|恒生|中概股|新兴市场/;

/** 国内政策主体：真正能改变定价的那几个口子。 */
const POLICY_BODY =
  /央行|人民银行|财政部|发改委|证监会|工信部|商务部|住建部|统计局|国常会|国务院|政治局|金融监管总局|国资委|能源局|邮政局|交易所|北交所|上交所|深交所/;

// ---------------------------------------------------------------------------
// 减分项：不改变定价的东西
// ---------------------------------------------------------------------------

/**
 * 行政体裁。这一类是本轮诊断里**占位最凶**的噪音：importance 打到 70，内容是开会、发指南、
 * 出警示函。它们既不改变任何定价，也不是「今天发生了什么」。
 */
const ADMIN_NOISE =
  /重点工作|推进会|座谈会|工作会议|党委|党建|表彰|评选|授牌|挂牌成立|揭牌|合规指引|指引发布|指南.{0,6}发布|国家标准|警示函|约谈|自律|培训|宣讲|专项行动|调研齐发|专委会|首单|综合保税区|示范区.{0,6}落地|试点加速|招商引资|签约仪式|亿元以上项目|重大项目开工/;

/**
 * IPO 审核流程。`IPO` 本身在硬事件里（新股定价确实是事件），但「辅导备案 / 受理 / 问询 /
 * 终止审核」是监管流水线上的一步，对二级市场定价几乎没有含义，却因为带 IPO 拿到 +3。
 */
const IPO_PROCESS = /IPO(辅导|备案|受理|问询|终止|中止|撤单|审核)|辅导备案|终止.{0,8}(IPO|审核)/;

/** 民生 / 文体 / 天气 / 航天——与 A 股定价无关。 */
const CIVIC_NOISE =
  /票房|电竞|电子竞技|桌游|穗岁康|投保|参保|开户数|气温|台风|暴雨|发射|卫星|旅游人次|凉皮|黄牛|F码|获奖|纪录片|权益保障|共同富裕|短板弱项/;

/**
 * 工商登记体裁。整整一个噪音家族，之前全落在 0-5 分的中间带里：
 * 「鸣鸣很忙等在上海成立食品公司」「山东数据集团登记成立 注册资本10亿」
 * 「中核（雄安）能源销售有限公司成立」「月之暗面完成工商变更登记」。
 * 新设一家子公司对二级市场定价基本没有含义，但它自带「注册资本 10 亿」这种金额，会白拿 +2。
 */
const REGISTRY_NOISE = /登记成立|工商(变更|登记)|注册资本|有限公司成立|公司成立|成立.{0,8}(公司|合伙企业)/;

/**
 * 宣传体裁：动词是「筑牢 / 多措并举 / 扎实推进」。
 * **罚得比其他噪音轻（-2）**：这是**文风**信号，不是**内容**信号——
 * 「住建部：扎实做好国债支持老旧小区加装电梯项目」文风是宣传，但「国债支持旧改」是真工具，
 * 按 -4 罚会把它判成负分直接丢掉。纯宣传（没有任何工具/数字）自然会落到负分。
 */
const PROPAGANDA = /筑牢|多措并举|扎实(推进|做好)|全力以赴|奋力|谱写|新篇章|亮出硬举措|显效/;

/**
 * A 股自身指数复述。首屏那条宽度带已经把涨跌家数、涨跌停、中位涨跌幅摆出来了；
 * 「创业板指跌5.2%」既是重复，也是**结果不是原因**——它没解释任何事。
 * 注意只拦 A 股自己的指数：海外指数异动是外生变量，是当天最该讲的东西之一。
 */
const A_INDEX = /创业板指|科创50|科创综指|科创板指|沪指|深成指|上证(指数|综指)|北证50|全A指数/;
const A_INDEX_MOVE =
  /(涨|跌|回落|走强|走弱|抹平|拉升|跳水|新高|新低|翻红|翻绿|失守|站上|收复)/;

/** 单只海外公司的盘中波动 / 卖方目标价——信息密度太低，占一条位置不值。 */
const SINGLE_FOREIGN_TICK = /(盘前|盘后)(涨|跌|走高|走低)|目标价|目标股价|评级/;

/** 券商观点：是判断不是事实。降权但不至于负到底——观点仍带信息，会议通报不带。 */
const BROKER_VIEW =
  /^(中信证券|中信建投|中金|华泰证券|申万宏源|国泰海通|广发证券|招商证券|海通|东吴|浙商证券|民生证券|天风|国信证券|方正|兴业证券|光大证券)[：:]/;

/** 军事 / 外交冲突，且没有价格传导路径的。 */
const GEOPOLITICAL = /导弹|袭击|谴责|无人居住|战机|巡逻|军演|开火|阵亡|停战谈判/;
/** 有这些就说明冲突有价格传导（油、气、航运、供应链），不该降权。 */
const GEO_PRICE = /油价|原油|布伦特|WTI|天然气|霍尔木兹|苏伊士|运价|航运|黄金|供应中断|禁运/;

/**
 * 这条市场级消息值多少分。分数只用于**排序与取舍**，不参与展示。
 * 负分表示「进复盘会稀释信息密度」——调用方（`rankMacroCandidates`）会直接不取。
 */
export function marketRelevanceScore(title: string, brief = ""): number {
  const t = `${title} ${brief}`;
  let score = 0;

  // 硬事件最多算两处：两个具体动作说明这条真的有内容，再多就多半是长标题堆词
  let hits = 0;
  for (const re of HARD_EVENT) {
    if (re.test(t)) hits++;
    if (hits >= 2) break;
  }
  score += hits * 3;

  if (POLICY_EVENT.test(t)) score += 3;
  if (NUM_ANCHOR.test(t)) score += 2;
  if (BIG_MONEY.test(t)) score += 2;
  if (EXOGENOUS.test(t)) score += 2;
  if (OVERSEAS_MARKET.test(t)) score += 2;
  if (POLICY_BODY.test(t)) score += 2;

  if (ADMIN_NOISE.test(t)) score -= 6;
  if (IPO_PROCESS.test(t)) score -= 3;
  if (CIVIC_NOISE.test(t)) score -= 4;
  if (REGISTRY_NOISE.test(t)) score -= 4;
  if (PROPAGANDA.test(t)) score -= 2;
  if (A_INDEX.test(t) && A_INDEX_MOVE.test(t)) score -= 6;
  if (SINGLE_FOREIGN_TICK.test(t)) score -= 4;
  if (BROKER_VIEW.test(title)) score -= 2;
  if (GEOPOLITICAL.test(t) && !GEO_PRICE.test(t)) score -= 4;

  return score;
}

// ---------------------------------------------------------------------------
// 同主体收口
// ---------------------------------------------------------------------------

/**
 * 同一件事被快讯源反复追更是常态：7/29 海外层 5 个位置里 4 个是韩股熔断
 * （「迈向史上最大单月跌幅」「监管紧急开会」「将召开紧急会议」「负责人致歉」），
 * 而美联储决议、微软/Meta 财报、SK海力士跌 17% 一条都没进去。
 *
 * 标题近重复与数字指纹都拦不住这种——措辞全不一样、数字也不一样。能拦住的是**主体**：
 * 这四条都在讲韩国。所以按主体设一个上限，把位置腾给别的事。
 *
 * 认不出主体就返回 null（不参与收口）——宁可放过，也不能把互不相关的条目挤成一个桶。
 */
const SUBJECTS: [RegExp, string][] = [
  [/美联储|沃什|鲍威尔|FOMC|议息/, "美联储"],
  [/特朗普|白宫|美国政府|美国商务部|美国财政部/, "美国政策"],
  [/韩国|韩股|首尔|韩元|KOSPI/, "韩国"],
  [/日本|日经|日元/, "日本"],
  [/欧盟|欧洲|欧央行|欧元区|德国|法国|英国/, "欧洲"],
  [/台积电/, "台积电"],
  [/SK海力士|海力士/, "SK海力士"],
  [/三星电子|三星/, "三星"],
  [/美光/, "美光"],
  [/旺宏/, "旺宏"],
  [/英伟达/, "英伟达"],
  [/微软/, "微软"],
  [/Meta|脸书/, "Meta"],
  [/苹果公司|苹果/, "苹果"],
  [/特斯拉/, "特斯拉"],
  [/OPEC|布伦特|WTI|原油|油价/, "原油"],
  [/(人民银行|央行).{0,20}(逆回购|MLF|LPR|降准|降息|流动性)|(逆回购|MLF|LPR|降准|降息).{0,20}(人民银行|央行)/, "央行"],
  [/人民银行|央行/, "央行"],
  [/证监会|交易所|北交所|上交所|深交所/, "监管"],
  [/发改委|工信部|商务部|财政部|统计局|国常会|国务院|政治局/, "部委"],
];

export function macroSubjectOf(title: string): string | null {
  for (const [re, name] of SUBJECTS) if (re.test(title)) return name;
  return null;
}

// ---------------------------------------------------------------------------
// 选材
// ---------------------------------------------------------------------------

/**
 * 跨源重复的数字指纹（沿用 `pickMacroItems` 的规则）：同一件事被两个源各发一条时，
 * 措辞会变、数字不会。只取 ≥4 位且不像年份的数字——年份满天飞，会把无关条目误并。
 */
function numericSignature(title: string): string[] {
  const nums = title.match(/\d{4,}/g) ?? [];
  return nums.filter((n) => {
    const v = Number(n);
    return !(n.length === 4 && v >= 1900 && v <= 2100);
  });
}

function stripPunct(title: string): string {
  return title.replace(/[\s，。、：:,."“”（）()【】！!?？|丨—～~]/g, "");
}

function dedupeKey(title: string): string {
  return stripPunct(title).slice(0, 18);
}

/**
 * 字符二元组的**包含率**近重复。前缀子串判定拦不住语序被打乱的同一件事——实测同一天里
 * 「业绩确定叠加分红稳定 沪主板蓝筹走强」「沪市主板蓝筹股逆势走强 业绩确定叠加分红稳定成"避风港"」
 * 「沪主板蓝筹逆势走强 业绩确定叠加分红稳定成"避风港"」三条各占了一个产业位。
 * 中文里同一件事的不同措辞，二元组重合度天然很高；按**较短那条**算包含率，
 * 短标题被长标题「覆盖」也能判出来。
 */
function bigrams(title: string): Set<string> {
  const s = stripPunct(title);
  const out = new Set<string>();
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  return out;
}

const NEAR_DUP_CONTAINMENT = 0.6;

function isNearDup(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size < 4) return false; // 太短的标题重合率不可信
  let hit = 0;
  for (const g of small) if (big.has(g)) hit++;
  return hit / small.size >= NEAR_DUP_CONTAINMENT;
}

export type RankOpts = {
  /** 每层最多取几条。 */
  perScope: number;
  /** 同一主体在同一层最多几条——韩股那种连续追更就靠这个收口。 */
  perSubject: number;
  /**
   * 「好料」的相关性下限。第一轮只收 ≥ 这个分的条目——某层当天只有 2 条真货，
   * 就只给 2 条，不要拿「苏州签约亿元以上项目1594个」把 6 个位置填满：
   * 素材里塞了废话，提示词再怎么写，模型也会照着写出废话。
   */
  minScore?: number;
  /**
   * 每层的兜底条数。`minScore` 是靠我手写的词表标定的，词表一定有洞
   * （「政治局会议召开」不带数字、不含硬事件词，只拿到 +2 就会被门槛砍掉）。
   * 所以第一轮不足这个数时，第二轮从剩下的非负分条目里按序补到这个数——
   * 门槛用来**排序择优**，不用来**静默删除**。
   */
  floorPerScope?: number;
};

export type RankedMacro = Record<DigestScope, RankableMacro[]>;

type Scored = { c: RankableMacro; idx: number; score: number };

/**
 * 按「相关性 → importance」排序后分层取材。
 * 与被它取代的 `pickMacroItems` 的四处差别：
 *   ① 排序主键从 `importance` 换成 `marketRelevanceScore`（importance 只做同分裂票）
 *   ② 负分条目**不取**，且默认只取 `minScore` 以上的好料，不足再兜底补
 *   ③ 同主体上限，把连续追更腾出来的位置让给别的事
 *   ④ 近重复从「前缀子串」升级成「二元组包含率」，语序被打乱的同一件事也能收口
 */
export function rankMacroCandidates(
  cands: RankableMacro[],
  { perScope, perSubject, minScore = 0, floorPerScope = 0 }: RankOpts,
): RankedMacro {
  const out: RankedMacro = { overseas: [], domestic: [], industry: [] };

  const scored: Scored[] = cands
    .map((c, idx) => ({ c, idx, score: marketRelevanceScore(c.title, c.brief) }))
    .filter(({ c }) => isMarketLevelWorthy(c.title))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || b.c.importance - a.c.importance || a.idx - b.idx);

  const seenTitles: Set<string>[] = [];
  const seenNums = new Set<string>();
  const subjectCount = new Map<string, number>();

  const tryTake = (s: Scored, cap: (scope: DigestScope) => number): boolean => {
    const { c } = s;
    const key = dedupeKey(c.title);
    const grams = bigrams(c.title);
    if (key.length >= 8 && seenTitles.some((prev) => isNearDup(prev, grams))) return false;
    const sig = numericSignature(c.title);
    if (sig.length > 0 && sig.some((n) => seenNums.has(n))) return false;

    const scope = classifyScope(c.title, c.brief);
    if (out[scope].length >= cap(scope)) return false;

    const subject = macroSubjectOf(c.title);
    const sk = subject ? `${scope}|${subject}` : null;
    if (sk && (subjectCount.get(sk) ?? 0) >= perSubject) return false;
    if (sk) subjectCount.set(sk, (subjectCount.get(sk) ?? 0) + 1);

    out[scope].push(c);
    if (key.length >= 8) seenTitles.push(grams);
    for (const n of sig) seenNums.add(n);
    return true;
  };

  // 第一轮：只收好料
  const leftover: Scored[] = [];
  for (const s of scored) {
    if (s.score < minScore) {
      leftover.push(s);
      continue;
    }
    if (!tryTake(s, () => perScope)) leftover.push(s);
  }
  // 第二轮：把没到 floorPerScope 的层补齐（只补到兜底数，不补到 perScope）
  if (floorPerScope > 0) {
    for (const s of leftover) tryTake(s, () => floorPerScope);
  }
  return out;
}
