// 复盘「有用信息」的判据层（张楚寒 2026-07-29 反馈）。相对导入、无 IO、可测。
//
// 反馈原话：「没有增量信息，说的都是正确的废话」「今天跌了就是受板块影响下跌，明天涨了就是受板块
// 影响上涨，一年都是这样」。这两句给出了「有用」的可操作定义：
//
//   **一句话如果换一天照样成立，它就没有信息量。**
//
// 落成两条机械判据：
//   ① 循环归因（把结果当原因）——「受半导体板块影响走跌」「跟随板块下跌」。板块涨跌本来就是成分股
//      涨跌的聚合，拿它解释成分股等于什么都没说。命中即废，**有没有数字都废**。
//   ② 事实锚点——一句话得挂着一个可核验的东西：数字、专有名词、或一个具体事件名。没锚点的
//      「市场情绪谨慎」「资金避险」也是每天都能写的。
//
// 判废后**宁可留空**：首屏顶一句正确的废话比空着更糟（同 parseDigestResponse 的既有立场）。

/** 数字 + 单位。「净买入19.97亿」「利率1.40%」「跌停」不算——跌停走事件锚点。 */
const NUM_ANCHOR =
  /\d+(\.\d+)?\s*(%|％|亿|万|元|美元|欧元|港元|点|倍|家|只|股|个基点|bp|BP|pct)/;

/** 专有名词锚点：央行 / 部委 / 海外机构 / 具体公司。出现即说明这句话指向了某个具体主体。 */
const NAME_ANCHOR =
  /美联储|欧央行|欧洲央行|日本央行|央行|发改委|财政部|证监会|工信部|住建部|商务部|国常会|国务院|金融监管总局|交易所|OPEC|IMF|特朗普|鲍威尔|白宫|美国|欧盟|日本|韩国|台湾|印度|越南|台积电|三星|SK海力士|美光|英伟达|AMD|英特尔|希捷|西部数据|苹果|微软|谷歌|Alphabet|亚马逊|特斯拉|OpenAI|Meta|ASML|阿斯麦/;

/**
 * 事件锚点：一个**具体发生过的动作**。这是最主要的一类锚点——「停火」「扩产」「回购」都不带数字，
 * 但每一个都是当天真实发生的事，换一天不成立。
 */
const EVENT_ANCHOR =
  /财报|半年报|年报|季报|中报|披露|业绩(预告|快报|预增|预减|预亏|扭亏)?|预增|预减|扭亏|中标|订单|收购|并购|重组|回购|增持|减持|解禁|定增|配股|分红|停牌|复牌|上市|首日|IPO|新股|调研|评级|上调|下调|降息|加息|降准|逆回购|MLF|LPR|关税|制裁|禁令|出口管制|停火|冲突|罢工|涨价|降价|提价|扩产|量产|投产|交付|产能|签约|合作|中标|获批|审批|注册|诉讼|和解|处罚|立案|退市|熔断|涨停|跌停|新高|新低|专利|发布会|减产|增产|库存|招标|中签|分拆|要约|举牌|换帅|辞任|任命|指引|会议|决议|数据发布|CPI|PPI|PMI|GDP|非农|失业率|油价|金价|铜价|锂价|汇率|人民币|内存价格|存储价格|运价/;

/** 一句话是否挂着可核验的事实锚点。 */
export function hasFactAnchor(text: string): boolean {
  return NUM_ANCHOR.test(text) || NAME_ANCHOR.test(text) || EVENT_ANCHOR.test(text);
}

/**
 * 归因 note 的判据，比 `isSubstantive` 更可靠：**用该标的当天到底有没有事实来判**，
 * 而不是靠我这份锚点词表。词表一定有洞——实测「纳入MSCI指数预期推动上涨」是条好归因，
 * 却因为 MSCI 不在词表里被误杀。
 *
 * 规则：
 * - 该标的当天**有**自有事实 → 提示词已经要求只能引用那些事实，这里只需再拦一道循环归因；
 * - 该标的当天**没有**事实 → note 一律作废。模型此时写出来的必然是编的或是板块废话。
 */
/** 纯方向复述：「板块走强」「股价承压」——把已经显示在旁边的涨跌幅又说了一遍。 */
const BARE_DIRECTION =
  /^(该?(板块|行业|个股|股价|公司))?(整体|普遍|集体|小幅|明显)?(走强|走弱|上涨|下跌|下挫|回调|调整|承压|反弹|领涨|领跌|震荡)[。.]?$/;

export function isValidAttribution(note: string, hasOwnFacts: boolean): boolean {
  const t = note.trim();
  if (t.length < 4) return false;
  if (isCircularAttribution(t) || BARE_DIRECTION.test(t)) return false;
  if (!hasOwnFacts) return false;
  // 有事实垫底也不等于写出了信息：太短又没锚点的（「资金流入明显」）仍然是复述
  return t.length >= 12 || hasFactAnchor(t);
}

/**
 * 循环归因：拿「板块 / 大盘 / 情绪 / 风险偏好」解释个股或板块自身的涨跌。
 * 这正是 sway 转述的那条——「所有都是受半导体板块影响走跌」，一年 365 天都能写。
 */
const CIRCULAR: RegExp[] = [
  // 受…板块/科技股/大盘/情绪…影响|拖累|带动
  /受.{0,14}(板块|行业|大盘|大市|市场|情绪|风险偏好|指数|系统性|大势|科技股|成长股|周期股|同行|大环境).{0,10}(影响|拖累|带动|压制|冲击|波及|覆盖|牵连|所累)/,
  // 跟随板块下跌 / 随大盘调整
  /(跟随|随着|跟跌|跟涨|同步)(板块|行业|大盘|大市|指数|市场)/,
  // 板块走弱，个股承压 —— 「，股价跌停」也算（跌停是结果不是原因）
  /(板块|行业|大盘|大市|指数|科技股|成长股|周期股)(整体|普遍|集体)?(走弱|走强|回调|调整|下跌|上涨|下挫|上扬|疲软|领跌|领涨)[，,、].{0,18}(下跌|上涨|承压|走弱|走强|回调|调整|表现|拖累|受压|下挫|跌停|涨停|走低|走高|回落)/,
  // 拖累科技股表现 / 拖累板块
  /拖累(科技股|成长股|周期股|板块|行业|个股|大盘|整体|市场)/,
  // 市场情绪/风险偏好下降，股价下跌
  /(市场情绪|风险偏好|避险情绪|资金面)(整体)?(下降|回落|走弱|谨慎|降温|升温|浓厚|改善)[，,、].{0,18}(下跌|上涨|承压|走弱|走强|回调|流出|流入)/,
  // 板块效应/系统性抛售/普跌行情 —— 单独成因时同样是废话
  /(板块效应|系统性(抛售|下跌|回调)|普跌(行情|格局)?|普涨(行情|格局)?)$/,
];

export function isCircularAttribution(text: string): boolean {
  return CIRCULAR.some((re) => re.test(text));
}

/**
 * 这句话值不值得出现在复盘里。
 * 循环归因**一票否决**（哪怕带了数字：「半导体板块领跌，股价跌停」也是废话）；其余要求有锚点。
 */
export function isSubstantive(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  if (isCircularAttribution(t)) return false;
  return hasFactAnchor(t);
}

/** 过滤一组文本，只留有实质的。用于 drivers。 */
export function keepSubstantive(items: string[]): string[] {
  return items.filter((t) => isSubstantive(t));
}

/**
 * 「明天你要看什么」的废话形态，和归因废话不是同一种：主语是板块/大盘/情绪，谓语是
 * 走势/表现/情绪/持续性——「关注半导体板块能否企稳」「留意市场情绪变化」，每天都能写，也无从验证。
 * 关注点本来就未必挂得上**今天**的锚点，所以只在「泛泛句式 + 没有任何锚点」时才判废；
 * 「兆易创新半年报披露时点」「东方证券收购上海证券的审批进展」都留得下来。
 */
const VAGUE_WATCH =
  /(板块|行业|大盘|大市|指数|市场|情绪|风险偏好|资金面?).{0,12}(走势|走向|表现|反应|变化|情绪|持续性|延续性|景气度|流向|能否|是否|会否)/;

export function isVacuousWatchpoint(text: string): boolean {
  const t = text.trim();
  // 门槛比归因低：关注点本来就常常很短（「美联储议息」5 个字，是完全合格的一条）
  if (t.length < 4) return true;
  if (isCircularAttribution(t)) return true;
  return VAGUE_WATCH.test(t) && !hasFactAnchor(t);
}

// ---------------------------------------------------------------------------
// 选材：市场级条目的「国际 / 国内 / 产业」分层
// ---------------------------------------------------------------------------

export type DigestScope = "overseas" | "domestic" | "industry";

export const SCOPE_LABEL: Record<DigestScope, string> = {
  overseas: "国际市场",
  domestic: "国内宏观",
  industry: "产业与公司",
};

/**
 * 海外：地域 / 海外央行 / 海外公司 / 跨境政策。
 * 2026-07-30 补洞：实测「欧洲股市多数走高」「德意志银行股价上涨4.9%」被判成「产业与公司」——
 * `欧股` 匹配不到「欧洲股市」（不相邻），海外投行也一个都没在表里。
 */
const OVERSEAS =
  /美股|纳指|纳斯达克|道指|道琼斯|标普|罗素|VIX|美联储|FOMC|沃什|鲍威尔|白宫|特朗普|美国|美债|美元|欧元|欧股|欧洲|欧盟|欧央行|欧洲央行|德国|法国|英国|英镑|日本|日经|日元|韩国|韩股|韩流|首尔|韩元|台湾|台股|加权指数|港股|恒生|中概股|亚太股市|加拿大|印度|越南|巴西|OPEC|布伦特|WTI|原油|黄金|伦铜|台积电|三星|SK海力士|美光|铠侠|英伟达|AMD|英特尔|希捷|西部数据|格芯|格罗方德|苹果|微软|谷歌|Alphabet|亚马逊|特斯拉|OpenAI|Meta|ASML|阿斯麦|保时捷|巴斯夫|强生|可口可乐|摩根|高盛|花旗|德意志|瑞银|汇丰|巴克莱|野村|瑞穗|关税|制裁|出口管制|地缘/;

/** 国内宏观：货币 / 财政 / 监管 / 统计数据 / 会议与规划。 */
const DOMESTIC =
  /央行|逆回购|MLF|LPR|降准|降息|存款准备金|国债|地方债|财政部|发改委|证监会|工信部|住建部|商务部|统计局|国常会|国务院|政治局|金融监管总局|交易所|北向资金|南向资金|外资|社融|信贷|CPI|PPI|PMI|GDP|经济|政策|规划|十五五|十四五|注册制|退市新规|印花税|公募|私募|险资|养老金|汇率|人民币/;

/**
 * 分层。顺序有意为之：**海外优先**——A 股当天最大的外生变量常常在海外（7/28 半导体大跌的真实原因
 * 是隔夜海外存储链重挫 + 韩股逼近熔断，而不是「半导体板块下跌」）。
 */
export function classifyScope(title: string, brief = ""): DigestScope {
  // 标题优先、摘要兜底。原来把两段拼起来一起判，摘要里随便一个「政策」就能把
  // 「百家药械企业中报前瞻」拽进「国内宏观」——标题才是这条消息在讲什么。
  if (OVERSEAS.test(title)) return "overseas";
  if (DOMESTIC.test(title)) return "domestic";
  const t = `${title} ${brief}`;
  if (OVERSEAS.test(t)) return "overseas";
  if (DOMESTIC.test(t)) return "domestic";
  return "industry";
}

/**
 * 市场级候选的噪声闸：个股盘口碎讯（龙虎榜/换手率/营业部）与纯导航体裁（早知道/盘前必读/看盘）
 * 不是「当天发生了什么」，进复盘只会稀释信息密度。
 */
const MARKET_LEVEL_NOISE =
  /龙虎榜|换手率|营业部|大宗交易|盘中异动|异动拉升|直线拉升|直线涨停|快速跳水|封板|涨停板|涨停分析|涨停复盘|\d+cm(涨停|跌停)|停复牌汇总|筹码变动|股东户数|资金流向日报|异动情报|竞价|盘前必读|盘前哨|盘前速递|盘前情报|早参|风口研报|研报精选|早知道|午间收评|收评|盘中播报|整点回顾|开盘播报|公告精选|重点关注财经事件|今日要闻|早报|见闻早餐|早餐\s*\||晨报|复盘\d|机会前瞻/;

export function isMarketLevelWorthy(title: string): boolean {
  if (title.trim().length < 8) return false;
  return !MARKET_LEVEL_NOISE.test(title);
}

export type MacroCandidate = {
  title: string;
  brief: string;
  source: string;
  importance: number;
};

export type MacroPicked = Record<DigestScope, MacroCandidate[]>;

// 选材本体在 `macro-relevance.ts`（`rankMacroCandidates`）。这里只留分层与噪声闸——
// 2026-07-30 把「按 importance 取前 N」换成「按相关性排序 + 同主体收口」时，原来的
// `pickMacroItems` 一并删掉：两把选材尺子并存必然漂。

// ---------------------------------------------------------------------------
// 市场宽度：把「今天到底是什么盘」变成数字
// ---------------------------------------------------------------------------

export type BreadthIn = { changePct: number };

export type MarketBreadth = {
  /** 有行情的样本数（全 A 覆盖池，非全市场口径时也如实标出） */
  counted: number;
  up: number;
  down: number;
  flat: number;
  /** 涨停 / 跌停：按 ±9.8% 近似（含创业板/科创板 20cm 的会低估，故只当下限） */
  limitUp: number;
  limitDown: number;
  /** 中位数涨跌幅——比指数更能代表「随便买一只今天是赚是亏」 */
  medianChangePct: number | null;
};

/**
 * 全 A 涨跌家数与中位涨跌幅。**指数会骗人**：权重股护盘时指数只跌 0.5%，而 4000 只在跌。
 * 「沪深京三市下跌个股近 2500 只」这种句子才是每天都不一样的增量信息。
 */
export function summarizeBreadth(flows: BreadthIn[]): MarketBreadth {
  let up = 0;
  let down = 0;
  let flat = 0;
  let limitUp = 0;
  let limitDown = 0;
  const vals: number[] = [];
  for (const f of flows) {
    const c = f.changePct;
    if (!Number.isFinite(c)) continue;
    vals.push(c);
    if (c > 0) up++;
    else if (c < 0) down++;
    else flat++;
    if (c >= 9.8) limitUp++;
    if (c <= -9.8) limitDown++;
  }
  vals.sort((a, b) => a - b);
  const mid = vals.length === 0 ? null : (vals.length % 2 === 1
    ? vals[(vals.length - 1) / 2]!
    : (vals[vals.length / 2 - 1]! + vals[vals.length / 2]!) / 2);
  return {
    counted: vals.length,
    up,
    down,
    flat,
    limitUp,
    limitDown,
    medianChangePct: mid === null ? null : Math.round(mid * 100) / 100,
  };
}
