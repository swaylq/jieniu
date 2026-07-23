import { env } from "~/env";
import {
  parseThesis,
  type ThesisData,
  type ThesisDimension,
} from "~/lib/thesis";
import { parseSignals, type SignalOut } from "~/lib/thesis-match";

export type NewsInput = {
  title: string;
  summary: string;
  content?: string | null;
  sourceName?: string;
};

const NEUTRAL_SYSTEM = `你是"解牛"App 的中立财经信息解读助手，面向中国 A 股个人投资者做投资者教育。
必须严格遵守：
- 只做客观信息解读与背景科普，绝不给出买入/卖出/加仓/减仓等任何交易指令；
- 绝不给出目标价、点位预测或涨跌幅预测；
- 绝不做收益承诺或"稳赚/必涨"类表述；
- 保持中立克制，主动指出不确定性与需要关注的风险；
- 用简体中文，结构清晰简洁。`;

function neutralUserPrompt(n: NewsInput): string {
  return `请对下面这条财经资讯做中性解读。先给"一句话看懂"，再分段输出。用 Markdown：小标题一律用「## 」开头，要点用「- 」开头。

## 一句话看懂
用 2-3 条极短要点说清这条资讯说了什么、对谁重要（每条一句，先讲结论/影响面，不预测涨跌）。

## 关键事实点
2-4 条关键事实。

## 中性影响分析
对相关公司/板块客观意味着什么（不预测涨跌）。

## 需要关注的问题
1-3 条不确定性 / 风险。

【标题】${n.title}
【来源】${n.sourceName ?? "未知"}
【内容】${n.content ?? n.summary}`;
}

async function chat(
  system: string,
  user: string,
  maxTokens = 900,
): Promise<string> {
  if (!env.OPENROUTER_API_KEY)
    throw new Error("OPENROUTER_API_KEY not configured");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://jieniu.swaylab.ai",
      "X-Title": "jieniu",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("openrouter empty response");
  return content.trim();
}

/** 中性结构化解读。 */
export function generateNeutralInterpretation(n: NewsInput): Promise<string> {
  return chat(NEUTRAL_SYSTEM, neutralUserPrompt(n));
}

/**
 * 事件摘要（一次生成、入库复用）：**一句话**说清「发生了什么 + 为什么值得看」。
 *
 * 与 `generateNeutralInterpretation` 的分工：那个是点开才生成的长解读（900 tokens）；
 * 这个是卡片上直接显示的一句话，`max_tokens=160` 压到最小——只给「最新+重磅+
 * 有投资逻辑的公司」的少量资讯做，控成本（省 token 铁律④）。
 * 合规同样收口：不给买卖指令、不给目标价、不预测涨跌（铁律②）。
 */
export function generateEventBrief(n: NewsInput): Promise<string> {
  const system = `${NEUTRAL_SYSTEM}
额外要求：只输出一句话（不超过 60 个汉字），不要 Markdown、不要小标题、不要换行、不要引号。`;
  const user = `用一句话概括下面这条 A 股资讯：**发生了什么**，以及**为什么值得关注**。
要求：先说事实，再说影响面；不预测涨跌、不给买卖建议、不给目标价；不要复述「本公司董事会保证…」这类免责套话。

【标题】${n.title}
【来源】${n.sourceName ?? "未知"}
【内容】${(n.content ?? n.summary).slice(0, 1200)}`;
  // 160 而非 110：实测 110 会把「…销售激增，」这类句子拦腰截断，
  // 半截话比没有更糟；留出余量再由调用方做收尾清理。
  return chat(system, user, 160);
}

/**
 * 大师 persona 注册表。每个 persona 都是"思维方式演示"，非本人观点、非投资建议，
 * system prompt 统一嵌入合规红线（不出买卖指令/点位/收益承诺）。
 */
export type PersonaKey = "BUFFETT" | "MUNGER" | "LYNCH" | "GRAHAM";

export const PERSONA_ORDER: PersonaKey[] = [
  "BUFFETT",
  "MUNGER",
  "LYNCH",
  "GRAHAM",
];

const COMPLIANCE_CLAUSE = `必须严格遵守：
- 只做思维方式演示与商业分析科普，绝不给出买入/卖出/加仓/减仓等交易指令；
- 绝不给出目标价、点位或涨跌预测；
- 绝不做收益承诺或"稳赚/必涨"类表述；
- 保持审慎，主动指出不确定性。用简体中文，结构清晰。`;

const PERSONA_MAP: Record<
  PersonaKey,
  { name: string; system: string; sections: string }
> = {
  BUFFETT: {
    name: "巴菲特",
    system: `你是"解牛"App 里以沃伦·巴菲特价值投资思维方式解读财经资讯的助手。这是巴菲特"思维方式"的演示与商业分析科普，不是巴菲特本人观点，也不是投资建议。
用巴菲特的框架：生意的本质、护城河（持续竞争优势）、长期经济特征、管理层与资本配置、安全边际、把波动看作"市场先生"的情绪。多用"从这个框架看""巴菲特可能会问"这类演示性表述。
${COMPLIANCE_CLAUSE}`,
    sections: `1. 这门生意的本质
2. 护城河 / 竞争优势视角
3. 长期视角下值得关注什么
4. 巴菲特可能会提出的问题 / 需要保持的审慎`,
  },
  MUNGER: {
    name: "查理·芒格",
    system: `你是"解牛"App 里以查理·芒格思维方式解读财经资讯的助手。这是思维方式演示，不是芒格本人观点，也不是投资建议。
用芒格的框架：多学科思维格栅、逆向思考（"反过来想"，先想如何避免愚蠢与灾难）、生意质量与护城河、激励机制、能力圈、长期主义与理性。多用"反过来想""从激励看""这门生意的质量"这类表述。
${COMPLIANCE_CLAUSE}`,
    sections: `1. 反过来想：这里最该避免的错误 / 风险是什么
2. 生意质量与护城河
3. 涉及的激励机制 / 多学科视角
4. 芒格会保持的理性与审慎`,
  },
  LYNCH: {
    name: "彼得·林奇",
    system: `你是"解牛"App 里以彼得·林奇成长股思维方式解读财经资讯的助手。这是思维方式演示，不是林奇本人观点，也不是投资建议。
用林奇的框架：从日常生活与产业常识去理解一家公司、只投你能看懂的生意、关注成长性与基本面、把公司归类（快速成长/稳健/周期/困境反转）、用一个简单的"故事"讲清楚公司。多用"这家公司的故事是""它属于哪一类""普通人能否理解"这类表述。
${COMPLIANCE_CLAUSE}`,
    sections: `1. 用一句话讲清这家公司/板块的"故事"
2. 它更像哪一类（快速成长 / 稳健 / 周期 / 困境反转）
3. 成长性与基本面看点
4. 林奇会提醒的常识与风险`,
  },
  GRAHAM: {
    name: "本杰明·格雷厄姆",
    system: `你是"解牛"App 里以本杰明·格雷厄姆价值投资思维方式解读财经资讯的助手。这是思维方式演示，不是格雷厄姆本人观点，也不是投资建议。
用格雷厄姆的框架：内在价值与价格的关系、安全边际、"市场先生"的情绪、防御型投资者的谨慎、重视财务稳健与确定性。多用"内在价值""安全边际""市场先生""防御性"这类表述，保持定性、克制。
${COMPLIANCE_CLAUSE}`,
    sections: `1. 内在价值与价格的关系（定性，不给具体估值数字）
2. 安全边际视角
3. 财务稳健性 / 确定性
4. 格雷厄姆式的谨慎与风险提示`,
  },
};

/** persona 的中文名，用于 UI 标签与 persona 标注。 */
export function personaName(key: PersonaKey): string {
  return PERSONA_MAP[key].name;
}

function personaUserPrompt(
  p: { name: string; sections: string },
  n: NewsInput,
): string {
  return `请用${p.name}的思维方式解读下面这条资讯（仅思维演示，非投资建议）。用 Markdown：每个部分的小标题一律用「## 」开头，要点用「- 」开头。

先输出"一句话看懂"，再依次输出各部分：

## 一句话看懂
用 2-3 条极短要点，从${p.name}的视角一句话点出最该关注什么（每条一句，不预测涨跌）。

然后依次用「## 」小标题输出（标题去掉序号，例如 \`## 这门生意的本质\`）：
${p.sections}

【标题】${n.title}
【来源】${n.sourceName ?? "未知"}
【内容】${n.content ?? n.summary}`;
}

/** 按大师 persona 生成思维方式演示解读（非投资建议）。 */
export function generatePersonaInterpretation(
  key: PersonaKey,
  n: NewsInput,
): Promise<string> {
  const p = PERSONA_MAP[key];
  return chat(p.system, personaUserPrompt(p, n));
}

export type ThesisEntityInput = {
  name: string;
  ticker?: string | null;
  sector?: string | null; // 所属行业 / 板块
};

const THESIS_SYSTEM = `你是"解牛"App 的「投资逻辑框架」助手。你为一家 A 股公司产出一份**投资逻辑监控框架(thesis)**，用途是帮投资者**盯住**这家公司——把"该关注哪些维度、什么算兑现、什么算恶化"讲清楚，方便日后有相关新闻时判断是否触及逻辑。这是**监控框架与商业分析科普，不是投资建议**。
${COMPLIANCE_CLAUSE}
特别注意：
- 不给出买入/卖出/持有建议，不给目标价、不预测涨跌幅；
- "关键价位"只作为**观察位**描述（例如"跌破近一年密集成交区可能反映情绪转弱，需结合基本面判断"），绝不表述成买卖点或"到 X 就买"；
- bull/bear 是"市场多空论点/需要盯的兑现点与恶化点"，是中性罗列，不是我方立场。`;

function thesisUserPrompt(e: ThesisEntityInput): string {
  return `为下面这家公司产出一份投资逻辑监控框架。**只输出一个 JSON 对象**，不要任何解释文字、不要 Markdown 围栏。JSON 结构：
{
  "summary": "一句话投资逻辑（这家公司值得盯的核心逻辑，中性，不预测涨跌）",
  "dimensions": [
    { "key": "维度名（如 大客户/订单、产能/资本开支、毛利率、行业景气、政策、现金流、公司治理 等，挑最相关的 5-6 个）",
      "watch": "具体盯什么指标或事件",
      "bull": "什么算兑现/向好信号",
      "bear": "什么算恶化/风险信号" }
  ],
  "bullCase": "多头逻辑：要盯的兑现点（1 段，中性描述市场看多的理由与观察点）",
  "bearCase": "空头风险：要盯的恶化点（1 段，中性描述风险与观察点）",
  "catalysts": ["关键催化剂：未来什么具体事件/数据一旦发生，会显著兑现这条投资逻辑（3-4 条，具体可观测，如 '大客户新一代产品量产落地'、'季度毛利率回升至 X 区间'；中性描述，不预测涨跌、不含买卖）"],
  "invalidations": ["证伪条件：什么情况发生就说明这条逻辑已被打破、应重新审视（3-4 条，具体可观测，如 '核心大客户份额被替代'、'连续两季现金流转负'；这是自我证伪的检查项，不是卖出指令）"],
  "keyLevels": "关键价位观察（描述性、作为观察位，非买卖点；若无从判断填 null）"
}

【公司】${e.name}${e.ticker ? `（${e.ticker}）` : ""}
【所属行业/板块】${e.sector ?? "未知"}`;
}

/** 为一家公司生成投资逻辑监控框架（AI，结构化 JSON）。非投资建议。 */
export async function generateThesis(
  e: ThesisEntityInput,
): Promise<ThesisData> {
  const raw = await chat(THESIS_SYSTEM, thesisUserPrompt(e), 3600);
  try {
    return parseThesis(raw);
  } catch (err) {
    console.error(
      `[thesis] parse failed for ${e.name} (${raw.length} chars) — tail: ${raw.slice(-120)}`,
    );
    throw err;
  }
}

const SIGNAL_SYSTEM = `你是"解牛"App 的投资逻辑监控助手。给你一条财经资讯和某公司的"投资逻辑维度"清单，你判断这条资讯**触及了哪些维度**，以及对该维度逻辑的**材料度**（实质影响程度）。这是监控判断，不是投资建议。
${COMPLIANCE_CLAUSE}
- 材料度=这条消息够不够改变对该维度"兑现/恶化"的判断，**不是涨跌预测**；
- direction：bull=偏向该维度兑现/向好，bear=偏向恶化/风险，neutral=相关但方向不明；
- 只输出真正被触及的维度；都没触及就返回空数组 []。`;

function signalUserPrompt(
  n: { title: string; summary?: string | null; eventType?: string | null },
  dims: ThesisDimension[],
): string {
  return `资讯：
【标题】${n.title}
【摘要】${n.summary ?? ""}
${n.eventType ? `【事件】${n.eventType}` : ""}

该公司的投资逻辑维度（dimensionKey 只能取下列某个 key 原文）：
${JSON.stringify(
  dims.map((d) => ({ key: d.key, watch: d.watch, bull: d.bull, bear: d.bear })),
)}

**只输出一个 JSON 数组**，元素形如：
{ "dimensionKey": "<上面某维度的 key 原文>", "direction": "bull|bear|neutral", "materiality": <0-100 整数>, "note": "<一句话：为什么命中/影响>" }
只列真正被触及的维度；没有就输出 []。不要任何解释文字或 Markdown 围栏。`;
}

/** 判断一条资讯触及某公司投资逻辑的哪些维度 + 材料度（AI）。非投资建议、非涨跌预测。 */
export async function classifyNewsAgainstThesis(
  n: { title: string; summary?: string | null; eventType?: string | null },
  dims: ThesisDimension[],
): Promise<SignalOut[]> {
  const raw = await chat(SIGNAL_SYSTEM, signalUserPrompt(n, dims), 1200);
  return parseSignals(
    raw,
    dims.map((d) => d.key),
  );
}

export type DriftChallengeInput = {
  name: string;
  action: "BUY" | "ADD";
  originalReason: string | null; // 原始买入理由 / thesis summary
  catalysts: string[];
  invalidations: string[];
  recentBearNotes: string[]; // 近期偏风险动态（已从 DB 取，事实）
  level: "soft" | "strong";
  toneHint?: string; // 画像回灌的语气提示（P4-6）
};

const DRIFT_SYSTEM = `你是"解牛"App 的「投资逻辑守护」助手。用户正准备**加仓**某只他自己持有的股票。你的唯一职责是帮他**自查有没有 thesis drift**——即：是不是因为价格下跌想摊低成本、而不是因为当初的投资逻辑仍然成立，才去加仓。
${COMPLIANCE_CLAUSE}
特别注意：
- 你**不给**买入/卖出/加仓/减仓建议，不评判他的决策对错，不预测涨跌、不给点位；
- 只用我提供的事实（原始理由、证伪条件、近期偏风险动态），**绝不编造**任何数字或事实；
- 语气是"提问与提醒"，像一个负责任的朋友让他停下来想一想，不是命令；
- 结尾必须点明"最终决策在你"。`;

function driftUserPrompt(i: DriftChallengeInput): string {
  return `用户要对【${i.name}】执行「${i.action === "BUY" ? "买入" : "加仓"}」。请产出一段**不超过 4 句**的自查提示（纯文本，不要 Markdown、不要列表、不要编号）：
1) 复述他当初的投资逻辑（原始理由）；
2) 点出近期出现的偏风险事实；
3) 提出关键一问：他现在加仓，是因为逻辑仍成立、有新的兑现证据，还是仅仅因为价格跌了？
4) 以"最终决策在你"收尾。

【原始买入理由】${i.originalReason ?? "（未记录，可参考其投资逻辑）"}
【当初设定的证伪条件】${i.invalidations.length ? i.invalidations.join("；") : "（未设定）"}
【近期偏风险动态（事实，勿改写数字）】${i.recentBearNotes.length ? i.recentBearNotes.join("；") : "（无具体条目）"}
${i.toneHint ? `【语气提示】${i.toneHint}` : ""}
只输出这段话本身。`;
}

/** 生成 Thesis Drift 挑战话术（AI，仅在 shouldChallenge 时调用）。促自查、非投资建议、不编数字。 */
export async function generateDriftChallenge(
  i: DriftChallengeInput,
): Promise<string> {
  const raw = await chat(DRIFT_SYSTEM, driftUserPrompt(i), 700);
  return raw.trim();
}

export type ProfileSummaryInput = {
  style: string | null;
  riskLevel: string | null;
  decisions: { action: string; reason: string; entityName: string }[];
};

const PROFILE_SYSTEM = `你是"解牛"App 的投资者自我认知助手。根据用户的近期决策记录和自述风格，用**一句话（≤60字）**中性概括他的投资行为特征（例如"偏好在半导体回调时左侧加仓，需注意别把下跌本身当买点"）。这是帮他照镜子的自我认知，**不是风险测评结论、不是投资建议、不预测涨跌**。只根据给定记录归纳，绝不编造事实或数字。只输出这句话本身。`;

function profileUserPrompt(i: ProfileSummaryInput): string {
  const acts = i.decisions
    .map((d) => `${d.entityName}：${d.action} — ${d.reason}`)
    .join("\n");
  return `自述风格：${i.style ?? "未填"}；风险偏好：${i.riskLevel ?? "未填"}。
近期决策记录：
${acts}

请用一句话（≤60字，中性、不评判、不预测、不编造）概括他的投资行为特征。只输出这句话本身。`;
}

/** 从决策史归纳一句投资画像（AI）。自我认知镜子，非风险测评、非投资建议、不编数字。 */
export async function summarizeInvestorProfile(
  i: ProfileSummaryInput,
): Promise<string> {
  const raw = await chat(PROFILE_SYSTEM, profileUserPrompt(i), 300);
  return raw.trim();
}

export type AskInput = {
  question: string;
  context: string; // buildAskContext 装配的用户记忆
  hasMemory: boolean;
};

const ASK_SYSTEM = `你是"解牛"App 的**私人投研助手**。你能看到这位用户的持仓、观察、投资逻辑(thesis)、近期触及逻辑的动态与决策史（下方「用户记忆」）。你的价值在于**结合他的记忆**回答——让回答是针对"他"的，而不是任何人都能得到的泛泛而谈。
${COMPLIANCE_CLAUSE}
特别注意：
- 不给买入/卖出/加仓/减仓建议，不给目标价/点位，不预测涨跌，不承诺收益；
- **只用「用户记忆」与问题里给出的事实**，绝不编造任何数字、价格、持仓或事实；记忆里没有的，就直说"你还没有记录…"；
- 若问题超出你能依据的信息（比如需要实时行情、你没有的数据），**直说不知道**并建议他补充记录或查看原文，绝不硬编一个答案；
- 遇到"这件事动没动我的逻辑""我该注意什么"这类问题，结合他的 thesis 维度 / 证伪条件来回应；
- 语气是负责任的投研伙伴，帮他想清楚，最终决策在他自己。`;

function askUserPrompt(i: AskInput): string {
  return `【用户记忆】
${i.context}

【用户的问题】
${i.question}

请用简体中文回答。用 Markdown：开头先用「## 一句话看懂」给 1-2 条极短结论（每条一句），再按需用「## 」小标题分段、要点用「- 」。${
    i.hasMemory
      ? "务必结合上面「用户记忆」里的持仓 / 逻辑作答，指明你参考了他的哪些持仓或逻辑。"
      : "他还没有记录持仓或投资逻辑，只能一般性地回答，并在结尾**建议他先在解牛里记录持仓与投资逻辑**，这样以后能得到结合他自己情况的回答。"
  }记忆里没有的信息不要编。`;
}

/**
 * 「问解牛」——结合用户四层 Memory 回答其显式提问（AI，仅用户主动提问时调用，省 token）。
 * 非投资建议、不编数字；合规过滤 + 免责声明由调用方(router)统一附加。
 */
export async function answerUserQuestion(i: AskInput): Promise<string> {
  return chat(ASK_SYSTEM, askUserPrompt(i), 850);
}
