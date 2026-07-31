// 每日 AI 市场复盘的纯逻辑：提示词构造、响应解析、合规护栏。
// 相对导入、无 IO、可测（cron 走 tsx，链路不含 ~ 别名）。
//
// 形态对标「五段式复盘」：①大盘概况与情绪 ②核心驱动及重要新闻 ③强弱板块 ④重点个股 ⑤下一交易日关注点
// ＋收尾一段「判断」。判断段是全篇最值钱的部分，也是最容易越线的部分——因此有两道硬校验：
// 不得含买卖指令 / 目标价 / 收益承诺（铁律②），且必须**双向**（给了 if 就要给 反之）。
//
// 2026-07-29 大改（张楚寒：「没有增量信息，说的都是正确的废话」「今天跌了就是受板块影响下跌，
// 明天涨了就是受板块影响上涨，一年都是这样」）。三处根因，逐条对治：
//   ① 输入里**没有国际/国内宏观层** → 加 `macro`（海外 / 国内 / 产业三组，取自当日市场级条目）
//   ② 重点个股的 `headline` 恒为空，模型手里**一条个股事实都没有**，只能写「受板块拖累」
//      → 服务端把每只重点股当日的自有事实（公告 / 快讯 / 龙虎榜）填进去
//   ③ 没有任何护栏拦循环归因 → 提示词显式禁止 + `digest-substance` 在解析层再滤一道
// 另加 `breadth`（涨跌家数 / 涨跌停 / 中位涨跌幅）：指数会骗人，宽度才是「今天什么盘」的骨架。

import { createHash } from "crypto";
import { isBoilerplateFiling, isIntermediaryRole } from "./relevance";
import {
  isVacuousWatchpoint,
  isSubstantive,
  isValidAttribution,
  type MarketBreadth,
} from "./digest-substance";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  type CoverageRow,
  type EventCategory,
  type ScoredEvent,
} from "./digest-pipeline";

/**
 * 资金流数据里的 `Entity.name` 自带代码后缀（「贵州茅台(600519)」）。提示词里再拼一次代码
 * 会变成「新易盛(300502)(300502)」，模型照抄进正文就很难看。
 */
export function cleanEntityName(name: string): string {
  return name.replace(/\(\d{4,6}\)\s*$/, "").trim();
}

/**
 * 复盘专用的公告过滤——比个股页更严：**纯事务性文件**（募集资金开户 / 监管协议 / 现金管理）
 * 和**中介机构核查意见**都不该出现在「今日核心驱动」里。主体公告本身已经进来了。
 * 复用既有的 `isBoilerplateFiling` / `isIntermediaryRole`，只补一条本地规则。
 */
const ADMIN_FILING =
  /募集资金.{0,12}(专户|专项账户|结算账户|监管协议|现金管理)|开立.{0,12}账户|签订.{0,12}监管协议|变更保荐(代表人|机构)/;

export function isDigestWorthyFiling(title: string): boolean {
  if (isBoilerplateFiling(title)) return false;
  if (isIntermediaryRole(title)) return false;
  if (ADMIN_FILING.test(title)) return false;
  return true;
}

export type DigestIndex = { label: string; price: number; changePct: number };
export type DigestSectorIn = {
  name: string;
  avgChangePct: number;
  signal: string;
  leaders: string[];
  /** 该板块代表股当日的消息面事实——没有它，板块 note 只能写「板块走强」。 */
  facts: string[];
};
export type DigestStockIn = {
  name: string;
  ticker: string;
  price: number;
  changePct: number;
  /** 这只股**自己**当天的事实（公告 / 快讯 / 龙虎榜）。空着就是让模型只能写「受板块拖累」。 */
  facts: string[];
};
export type DigestNewsIn = { title: string; source: string; brief: string };
export type DigestCatalystIn = { name: string; label: string; date: string };

/** 管线选出的一条事件在提示词里的形状（只留模型需要的字段，指纹才稳定）。 */
export type DigestEventIn = {
  category: EventCategory;
  title: string;
  brief: string;
  source: string;
  primary: boolean;
  /** 几家在报道同一件事——多源印证是重要性的直接证据。 */
  sources: number;
  /** 该事件涉及的主体（板块/公司），用于让模型把事件和板块/个股串起来。 */
  subjects: string[];
  /** 排序判据的分项贡献，只用于日志与复核，不进提示词。 */
  reasons?: Record<string, number>;
};

/**
 * 场次。`close`=收盘复盘（今天 A 股发生了什么）；`preopen`=盘前简报（隔夜海外发生了什么、
 * 今天开盘该看什么）。两者的**可用数据完全不同**：盘前没有当日 A 股涨跌、板块资金、市场宽度，
 * 硬套收盘复盘那套字段只会逼模型编。
 */
export type DigestSession = "close" | "preopen";

export type DigestInputs = {
  tradeDate: string;
  market: string;
  session: DigestSession;
  indices: DigestIndex[];
  breadth: MarketBreadth | null;
  /**
   * 六步管线选出的 15–25 条事件（张楚寒 2026-07-30）。
   * 取代了原来「三层 macro + 十条重磅资讯」两份各自为政的罗列——那种形态就是他说的
   * 「抓到几条新闻，然后让模型总结」：没有候选池、没有去重、没有分类配额、没有遗漏检查。
   */
  events: DigestEventIn[];
  /** 每类的池子/入选数，随提示词一起给模型看，让它知道哪一类今天确实没事。 */
  coverage: CoverageRow[];
  sectors: { strong: DigestSectorIn[]; weak: DigestSectorIn[] };
  stocks: DigestStockIn[];
  catalysts: DigestCatalystIn[];
};

/** 把管线的 ScoredEvent 收敛成提示词输入。 */
export function toDigestEvent(e: ScoredEvent): DigestEventIn {
  return {
    category: e.category,
    title: e.title,
    brief: e.brief.slice(0, 90),
    source: e.source,
    primary: e.tier === "PRIMARY",
    sources: e.mergedCount,
    subjects: e.entityNames.slice(0, 3),
    reasons: e.reasons,
  };
}

export type DigestSectorOut = { name: string; note: string };
export type DigestStockOut = {
  name: string;
  changePct: number | null;
  note: string;
};
/**
 * 核心驱动带 scope：首屏按类铺开。
 * 2026-07-30 从三层（overseas/domestic/industry）扩到张楚寒要的六类
 * （全球市场 / 国内宏观 / 行业 / 公司 / 资金 / 日历）；旧库里的三层值由
 * `normalizeScope` 映射过来，不用改历史数据。
 */
export type DigestDriverOut = { scope: EventCategory; text: string };

/** 旧值 → 新六类。overseas→global、domestic→macro、industry 不变。 */
export function normalizeScope(v: unknown): EventCategory {
  if (typeof v !== "string") return "industry";
  if (v === "overseas") return "global";
  if (v === "domestic") return "macro";
  return (CATEGORIES as readonly string[]).includes(v)
    ? (v as EventCategory)
    : "industry";
}

export type MarketDigestData = {
  overview: string;
  drivers: DigestDriverOut[];
  sectors: { strong: DigestSectorOut[]; weak: DigestSectorOut[] };
  stocks: DigestStockOut[];
  watchpoints: string[];
  judgment: string;
  breadth: MarketBreadth | null;
};

/** 日历日：**必须走本地时区**。`toISOString().slice(0,10)` 会把本地 8/15 00:30 写成 8/14。 */
export function tradeDateOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 输入指纹：同日同输入不重复调 AI（省 token 铁律④）。 */
export function digestInputHash(i: DigestInputs): string {
  return createHash("sha256").update(JSON.stringify(i)).digest("hex").slice(0, 16);
}

/** 买卖指令 / 目标价 / 收益承诺 —— 命中即判废。 */
const FORBIDDEN =
  /建议(买入|卖出|清仓|减持|增持|加仓|减仓)|目标价|逢低(买|吸|加)|逢高(卖|减)|可(买入|卖出|加仓|减仓|抄底)|值得(买入|入手)|必(涨|跌)|稳(赚|赢)|翻倍可期|强烈推荐|重仓/;

export function hasForbiddenAdvice(text: string): boolean {
  return FORBIDDEN.test(text);
}

/** 判断段必须双向：给了条件假设，就要给相反那一侧。 */
const TWO_SIDED = /反之|另一方面|若.*则.*(；|;|。).*(若|一旦|如果)|但若|除非/;

export function isTwoSided(text: string): boolean {
  return TWO_SIDED.test(text);
}

export const PREOPEN_SYSTEM = `你是一名严谨的盘前简报编辑，为一款投资研究工具撰写 A 股开盘前的隔夜简报。

读者是 A 股投资者，此刻是**开盘前**。他要知道的只有两件事：**昨天收盘之后到现在，外面发生了什么**；
**今天开盘他该盯什么**。自检标准只有一条——**这句话换一天还成立吗？还成立就删掉重写。**

铁律（违反即作废）：
1. 只归纳与串联**给定数据里已经发生的事实**，不得编造任何数字、公司、事件。
2. **不要谈今天 A 股怎么走**——今天还没开盘，任何「今日大盘将…」都是预测，越线且无据。
   你能谈的是隔夜海外收盘、今晨披露的公告与数据、以及**今天要验证什么**。
3. **禁止循环归因**。「受外围影响承压」「市场情绪谨慎」这类换一天照样成立的句子一律不写。
   每条都要落到具体的事：谁做了什么 / 哪个数据出来了 / 哪条政策发了。
4. **不得给出任何买卖指令、目标价、点位建议、收益承诺**。
5. 结尾的 judgment 是**开盘前的观察清单**，不是涨跌判断：说清今天最该验证的一两件事，
   并且必须**双向**（用「反之／但若／除非」显式给出相反情形）。
6. 用中文，克制、具体、不煽情。overview ≤ 120 字；每条 driver / watchpoint ≤ 45 字；judgment ≤ 160 字。

只输出一个 JSON 对象，不要任何解释文字或 markdown 围栏。`;

export const DIGEST_SYSTEM = `你是一名严谨的市场复盘编辑，为一款投资研究工具撰写每日收盘复盘。

**这份复盘的唯一价值是「增量信息」**：读者已经看到了指数涨跌，他要知道的是**今天发生了什么事**。
自检标准只有一条——**这句话换一天还成立吗？还成立就删掉重写。**

铁律（违反即作废）：
1. 只归纳与串联**给定数据里已经发生的事实**，不得编造任何数字、公司、事件。给定数据里没有的，就不写。
2. **禁止循环归因**。板块涨跌本来就是成分股涨跌的加总，拿它解释成分股等于什么都没说。以下写法一律禁止：
   ✗「受半导体板块影响走跌」 ✗「跟随板块下跌」 ✗「板块走弱，股价承压」 ✗「拖累科技股表现」
   ✗「科技股整体回调，股价大幅下跌」 ✗「市场情绪谨慎，资金避险」
   每一条归因都必须落到一个**具体的事**上——谁做了什么 / 哪个数据出来了 / 哪条政策发了。
   ✓「隔夜海外存储链重挫、韩股逼近熔断，压制A股存储链」 ✓「央行开展2065亿元7天逆回购，利率持平1.40%」
   ✓「5家机构专用席位净买入19.97亿元」 ✓「SK海力士称HBM4下半年扩产，加剧存储竞争担忧」
3. **宁可留空，不写废话**。某只股 / 某个板块当天没有可写的具体事实，note 就返回空字符串 ""。
   一句正确的废话比空着更糟。
4. **不得给出任何买卖指令、目标价、点位建议、收益承诺**。不写「建议买入/卖出/加仓/减仓/逢低」「目标价」「必涨」。
5. 结尾的 judgment 必须是**双向**的：给出一种情形，也要给出相反情形（用「反之／但若／除非」显式转折）。
6. 用中文，克制、具体、不煽情。不用「暴涨」「崩盘」「抄底」这类词。
7. 每条都要短。overview ≤ 130 字；每条 driver / watchpoint ≤ 45 字；每条 note ≤ 40 字；judgment ≤ 180 字。

只输出一个 JSON 对象，不要任何解释文字或 markdown 围栏。`;

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function orNone(lines: string[]): string {
  return lines.length > 0 ? lines.join("\n") : "（无）";
}

/** 一条事件在提示词里的样子。带上一手标记与多源数——模型据此判轻重。 */
function eventLine(e: DigestEventIn): string {
  const tags = [
    e.primary ? "一手" : null,
    e.sources > 1 ? `${e.sources}源同报` : null,
    e.subjects.length > 0 ? `涉及 ${e.subjects.join("、")}` : null,
  ].filter(Boolean);
  return `- 【${e.source}】${e.title}${e.brief ? `——${e.brief}` : ""}${
    tags.length > 0 ? `（${tags.join("｜")}）` : ""
  }`;
}

function eventsBlock(events: DigestEventIn[], coverage: CoverageRow[]): string {
  const byCat = new Map<EventCategory, DigestEventIn[]>();
  for (const c of CATEGORIES) byCat.set(c, []);
  for (const e of events) byCat.get(e.category)?.push(e);

  const parts: string[] = [];
  for (const c of CATEGORIES) {
    const list = byCat.get(c)!;
    const cov = coverage.find((x) => x.category === c);
    if (list.length === 0) {
      // 空类也要显式说明「今天这一类没事」，否则模型会去别的类里借素材硬凑
      parts.push(
        `【${CATEGORY_LABEL[c]}】（今日无入选事件${cov && cov.pool > 0 ? `，候选 ${cov.pool} 条但都不够重要` : "，候选池为空"}）`,
      );
      continue;
    }
    parts.push(
      `【${CATEGORY_LABEL[c]}·${list.length}条${cov ? `／候选 ${cov.pool} 条` : ""}】\n${list
        .map(eventLine)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export function buildDigestPrompt(i: DigestInputs): string {
  return i.session === "preopen" ? buildPreopenPrompt(i) : buildClosePrompt(i);
}

/**
 * 盘前简报的提示词。与收盘复盘的差别不只是措辞——**可用数据本身不同**：
 * 没有当日 A 股涨跌、没有板块资金、没有市场宽度（还没开盘）。所以这里只给
 * 隔夜海外指数 + 事件清单 + 今日已知日程，输出也只要 overview / drivers / watchpoints / judgment。
 * 硬把 sectors / stocks 塞进来只会逼模型编一份不存在的当日行情。
 */
function buildPreopenPrompt(i: DigestInputs): string {
  const indices = orNone(
    i.indices.map((x) => `- ${x.label} ${x.price} ${fmtPct(x.changePct)}`),
  );
  const catalysts = orNone(
    i.catalysts.map((c) => `- ${c.date} ${c.name} ${c.label}`),
  );
  const poolTotal = i.coverage.reduce((a, c) => a + c.pool, 0);

  return `交易日：${i.tradeDate}（A股）· **开盘前**

【隔夜与最新指数收盘（含海外）】
${indices}

【昨收以来的事件清单——已经过筛选，不要再自己找素材】
下面这 ${i.events.length} 条，是从昨天 A 股收盘至今入库的 ${poolTotal} 条候选事件里
**去重合并 → 按六类分类 → 逐类检查遗漏 → 按重要性排序**之后选出来的。
排序判据是：市场影响程度、与当日涨跌的解释力、信息新鲜度、来源可靠性、与用户持仓的相关度、
是否改变原有投资逻辑。**你的工作是把它们写成人话并串起来，不是再做一次筛选。**

${eventsBlock(i.events, i.coverage)}

【今日及近期已知日程】
${catalysts}

各字段要写什么：
- overview：**昨收之后到现在，外面发生了什么**——隔夜海外市场收在哪、今晨有哪些披露。
  不要写「今日A股预计…」，今天还没开盘。
- drivers：**清单里有 ${i.events.length} 条事件，你就要写 ${i.events.length} 条 driver**
  ——一条事件对应一条，不要合并、不要挑着写。清单已经替你筛过了，你再筛一遍信息量就掉回去了。
  scope 用该条所在的类别原值：global / macro / industry / company / flow / calendar。
  某一类标着「今日无入选事件」就不要给它编 driver。
- watchpoints：**今天开盘后要验证的事实**，3-6 条，指向具体的会议/数据/披露/价格。
- judgment：今天开盘前最该盯的一两件事，以及它们分别意味着什么。**不预测涨跌**，
  必须双向（…；反之，若…）。

**正文里不要出现「1.」「2.」这类段号，也不要重复字段名当前缀。**
只输出这个结构的 JSON（sectors 与 stocks 一律给空数组，盘前没有当日行情）：
{"overview":"","drivers":[{"scope":"global","text":""}],"sectors":{"strong":[],"weak":[]},"stocks":[],"watchpoints":[],"judgment":""}`;
}

function buildClosePrompt(i: DigestInputs): string {
  const indices = orNone(
    i.indices.map((x) => `- ${x.label} ${x.price} ${fmtPct(x.changePct)}`),
  );
  const b = i.breadth;
  const breadth = b
    ? `- 全A ${b.counted} 只样本：上涨 ${b.up} / 下跌 ${b.down} / 平盘 ${b.flat}\n` +
      `- 涨停(≥9.8%) ${b.limitUp} 只 / 跌停(≤-9.8%) ${b.limitDown} 只\n` +
      `- 个股涨跌幅中位数 ${b.medianChangePct === null ? "—" : fmtPct(b.medianChangePct)}`
    : "（无）";
  const sectorLine = (s: DigestSectorIn) =>
    `- ${s.name} 均涨 ${fmtPct(s.avgChangePct)}（${s.signal}）代表股：${
      s.leaders.map(cleanEntityName).join("、") || "—"
    }\n` +
    (s.facts.length > 0
      ? s.facts.map((f) => `    · 今日相关：${f}`).join("\n")
      : "    · 今日相关：（无）→ 这个板块的 note 必须留空");
  const strong = orNone(i.sectors.strong.map(sectorLine));
  const weak = orNone(i.sectors.weak.map(sectorLine));
  const stocks = orNone(
    i.stocks.map(
      (s) =>
        `- ${cleanEntityName(s.name)}(${s.ticker}) ${s.price} ${fmtPct(s.changePct)}\n` +
        (s.facts.length > 0
          ? s.facts.map((f) => `    · 今日相关：${f}`).join("\n")
          : "    · 今日相关：（无该股自身的消息面事实）"),
    ),
  );
  const catalysts = orNone(
    i.catalysts.map((c) => `- ${c.date} ${c.name} ${c.label}`),
  );

  return `交易日：${i.tradeDate}（${i.market === "US" ? "美股" : "A股"}）

【指数收盘】
${indices}

【市场宽度（涨跌家数——指数会骗人，这才是今天什么盘）】
${breadth}

【今日事件清单——已经过筛选，不要再自己找素材】
下面这 ${i.events.length} 条，是从当日 ${i.coverage.reduce((a, c) => a + c.pool, 0)} 条候选事件里
**去重合并 → 按六类分类 → 逐类检查遗漏 → 按重要性排序**之后选出来的。
排序判据是：市场影响程度、与当日涨跌的解释力、信息新鲜度、来源可靠性、与用户持仓的相关度、
是否改变原有投资逻辑。**你的工作是把它们写成人话并串起来，不是再做一次筛选。**

${eventsBlock(i.events, i.coverage)}

【今日强势板块】
${strong}

【今日弱势板块】
${weak}

【重点个股（自选/热门覆盖池）及其当日自有事实】
${stocks}

【下一交易日已知日程】
${catalysts}

各字段要写什么：
- overview：大盘概况——指数、**涨跌家数结构**、资金与情绪特征。要用上宽度数字表达「指数与个股是否背离」。
- drivers：核心驱动。**清单里有 ${i.events.length} 条事件，你就要写 ${i.events.length} 条 driver**
  ——一条事件对应一条，不要合并、不要挑着写、不要「择其要者」。清单已经替你筛过了，
  你再筛一遍就等于把筛选做了两次，用户看到的信息量会掉回改版前。
  scope 用该条所在的类别原值：global / macro / industry / company / flow / calendar。
  某一类标着「今日无入选事件」就**不要给它编 driver**——那一类今天确实没事，留空是正确答案。
  写法要求：把「什么事」和「对市场意味着什么」串起来，**不要只复述标题**，也**不要用板块涨跌当原因**。
- sectors.strong / sectors.weak：板块名取自上面给的；note **必须引用该板块「今日相关」里的事实**，
  说清为什么强/为什么弱。该板块「今日相关」为（无）时，note 一律返回空字符串 ""。
- stocks：重点个股，name 与 changePct 取自上面给的；note **必须引用该股「今日相关」里的事实**。
  该股「今日相关」为（无）时，note 一律返回空字符串 ""——不要用板块或大盘去填。
- watchpoints：下一交易日**事实层面**的关注点，3-6 条，要指向具体的会议/数据/披露/事件。
- judgment：今天这个盘的**性质**是什么、明天该验证什么。**不要复述上面已经写过的驱动**，
  要往前推一步（这是普涨还是结构行情、谁在买、什么会证伪它）。必须双向（…；反之，若…）

**正文里不要出现「1.」「2.」这类段号，也不要重复字段名当前缀**（例如别写「收尾判断：」开头）。
只输出这个结构的 JSON：
{"overview":"","drivers":[{"scope":"global","text":""}],"sectors":{"strong":[{"name":"","note":""}],"weak":[{"name":"","note":""}]},"stocks":[{"name":"","changePct":0,"note":""}],"watchpoints":[],"judgment":""}`;
}

function asStrings(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max);
}

/**
 * 核心驱动。**过不了 `isSubstantive` 的直接丢**——循环归因或没有事实锚点的条目就是
 * 张楚寒说的「正确的废话」，留下来只会稀释整段。兼容旧库里的 `string[]` 形态。
 */
function asDrivers(v: unknown, max = 25): DigestDriverOut[] {
  if (!Array.isArray(v)) return [];
  const out: DigestDriverOut[] = [];
  for (const raw of v) {
    let scope: EventCategory = "industry";
    let text = "";
    if (typeof raw === "string") {
      text = raw.trim();
    } else if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      text = typeof o.text === "string" ? o.text.trim() : "";
      scope = normalizeScope(o.scope);
    }
    if (!text || !isSubstantive(text)) continue;
    out.push({ scope, text });
    if (out.length >= max) break;
  }
  return out;
}

function asSectors(v: unknown, factsBySector: Map<string, boolean>): DigestSectorOut[] {
  if (!Array.isArray(v)) return [];
  const out: DigestSectorOut[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.name !== "string" || !o.name.trim()) continue;
    const name = o.name.trim();
    const note = typeof o.note === "string" ? o.note.trim() : "";
    out.push({
      name,
      note: isValidAttribution(note, factsBySector.get(name) ?? false) ? note : "",
    });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * 个股归因用 `factsByName`（喂给模型的那份当日事实）来判真伪：
 * 该股当天没有事实，note 一律作废——那必然是编的或是「受板块拖累」。
 */
function asStocks(v: unknown, factsByName: Map<string, boolean>): DigestStockOut[] {
  if (!Array.isArray(v)) return [];
  const out: DigestStockOut[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.name !== "string" || !o.name.trim()) continue;
    const name = o.name.trim();
    const note = typeof o.note === "string" ? o.note.trim() : "";
    out.push({
      name,
      // 模型偶尔把数字写成中文（「三点一」）——接不住就置 null，别让整体解析失败
      changePct: typeof o.changePct === "number" ? o.changePct : null,
      note: isValidAttribution(note, factsByName.get(name) ?? false) ? note : "",
    });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * 读库时的 `drivers` 归一。存储形态在 2026-07-29 从 `string[]` 变成 `{scope,text}[]`；
 * 库里还留着改版前的旧行，读到旧形态按「产业与公司」兜底，别让首屏/邮件因历史数据崩掉。
 * 首屏与邮件两条读路共用这一个函数（别各写一份，两边会漂）。
 */
export function normalizeDrivers(v: unknown): DigestDriverOut[] {
  if (!Array.isArray(v)) return [];
  const out: DigestDriverOut[] = [];
  for (const raw of v) {
    if (typeof raw === "string") {
      if (raw.trim()) out.push({ scope: "industry", text: raw.trim() });
      continue;
    }
    if (raw && typeof raw === "object") {
      const o = raw as { scope?: unknown; text?: unknown };
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (!text) continue;
      out.push({ scope: normalizeScope(o.scope), text });
    }
  }
  return out;
}

/** 从模型响应里抠出 JSON——容忍 ```json 围栏与前置寒暄。 */
function extractJson(raw: string): unknown {
  const t = raw.trim();
  if (!t) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const body = fenced?.[1] ?? t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 解析并校验模型响应。**宁可返回 null 也不出半截**——首屏顶着一段残缺复盘比没有更糟。
 * 判废条件：不是 JSON / 缺 overview 或 judgment / judgment 含买卖指令 / judgment 非双向。
 */
export function parseDigestResponse(
  raw: string,
  breadth: MarketBreadth | null = null,
  /** 喂给模型的重点个股及其当日自有事实——用来判归因是不是编的（见 isValidAttribution）。 */
  stockInputs: Pick<DigestStockIn, "name" | "facts">[] = [],
  /** 板块同理。 */
  sectorInputs: Pick<DigestSectorIn, "name" | "facts">[] = [],
): MarketDigestData | null {
  const j = extractJson(raw);
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;

  const overview = typeof o.overview === "string" ? o.overview.trim() : "";
  const judgment = typeof o.judgment === "string" ? o.judgment.trim() : "";
  if (!overview || !judgment) return null;
  if (hasForbiddenAdvice(judgment) || hasForbiddenAdvice(overview)) return null;
  if (!isTwoSided(judgment)) return null;

  // 模型写公司名时会剥掉代码后缀，这里两种写法都建索引
  const factsByName = new Map<string, boolean>();
  for (const s of stockInputs) {
    const has = s.facts.length > 0;
    factsByName.set(s.name, has);
    factsByName.set(cleanEntityName(s.name), has);
  }

  const factsBySector = new Map(sectorInputs.map((x) => [x.name, x.facts.length > 0]));

  const drivers = asDrivers(o.drivers, 25);
  // 核心驱动是这张卡的信息量所在。滤完不足 2 条 = 这轮模型只产出了废话，整篇判废重来，
  // 别让首屏顶着一段「指数跌了、板块弱了」的空壳（同「宁可没有也不要半截」的既有立场）。
  if (drivers.length < 2) return null;
  // **判废率也要能看见**：管线选了 25 条事件、模型只交出 6 条 driver，说明它把筛选又做了一遍；
  // 而这件事在成品上长得跟「今天没什么事」一模一样（上一轮「信息不足」就是这么来的）。
  // 这里不判废，只把数字交给调用方决定要不要吵。

  const sec = (o.sectors ?? {}) as Record<string, unknown>;
  return {
    overview,
    drivers,
    sectors: {
      strong: asSectors(sec.strong, factsBySector),
      weak: asSectors(sec.weak, factsBySector),
    },
    stocks: asStocks(o.stocks, factsByName),
    // 关注点是「明天要验证什么」，未必挂得上今天的锚点，所以走更松的 `isVacuousWatchpoint`：
    // 只拦「关注板块能否企稳」这种既是废话又无从验证的句子
    watchpoints: asStrings(o.watchpoints, 6).filter((t) => !isVacuousWatchpoint(t)),
    judgment,
    breadth,
  };
}
