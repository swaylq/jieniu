import type { ThesisDimension } from "./thesis";
import { IMPORTANT_THRESHOLD } from "./importance";
import { filingExcerpt } from "./filing-excerpt";

/**
 * 喂给证据分类器的正文。**不能只喂 summary**——A 股公告的 summary 是正文前 128 字，
 * 恒定是「证券代码…本公司董事会及全体董事保证…不存在虚假记载」这段法务套话，
 * 真正的数字在它后面。实测「大普微 2026 半年度业绩预告」(importance 85、PRIMARY) 因此
 * 产出 0 条证据：模型手上一个数字都没有，返回 [] 是**正确行为**——是我们没给料。
 * 接上 `filingExcerpt` 后同一条给出了「扣非净利 119,500～134,500 万元、扭亏为盈」。
 */
export function evidenceBody(
  title: string,
  content: string | null | undefined,
  summary: string | null | undefined,
  max = 700,
): string {
  const raw = content ?? summary ?? "";
  const ex = filingExcerpt(title, raw, max);
  return ex.length >= 20 ? ex : (summary ?? "").slice(0, max);
}

/**
 * Gate 1（省 token 硬闸）：够"材料"的新闻才上 AI 分类——一手公告(PRIMARY，公司自己的披露，天然与逻辑相关)、
 * 或重磅(importance≥阈值)、或带事件类型。routine 媒体闲讯(MEDIA 低分无事件)直接挡下。
 */
export function isMaterialCandidate(n: {
  importance: number;
  eventType: string | null;
  tier: string;
}): boolean {
  return (
    n.tier === "PRIMARY" || n.importance >= IMPORTANT_THRESHOLD || !!n.eventType
  );
}

/**
 * 证据候选闸（2026-07-30）。`isMaterialCandidate` 对 A 股太宽——几乎所有公告都是 PRIMARY，
 * 于是 AI 预算大半烧在「关于日常关联交易的公告」「关于召开股东会的通知」上。
 * 实测探针 8 条候选里 6 条是这类，模型**正确地**全部返回 []。
 *
 * 这里挡的只有**纯公司治理程序文件**：标题本身就说明了它不含经营事实。
 * 刻意**不**挡：投资者关系活动记录表（调研纪要里有真实经营信息）、高管变动（是治理证据）、
 * 问询函回复、回购/增减持进展（都带真数字）、法律意见书（主体往往是分红/激励等实质事件）。
 */
const PROCEDURAL_FILING =
  /(股东大?会|董事会|监事会).{0,12}(通知|决议公告|会议资料|会议材料|议事规则)|第[一二三四五六七八九十百\d]+届.{0,12}(董事会|监事会).{0,14}会议决议|日常关联交易|关联交易的?公告|对外担保|提供担保的?公告|委托理财|现金管理|闲置(募集|自有)?资金|变更(注册地址|办公地址|证券事务代表|保荐代表人|会计师事务所)|独立董事(候选人|提名)|续聘.{0,10}会计师事务所|募集资金.{0,12}(存放|专户|使用情况的?专项报告)/;

/** 这条资讯有没有可能承载「证据」——纯治理程序文件一律不上 AI（省 token，不损证据）。 */
export function isEvidenceCandidate(title: string): boolean {
  return !PROCEDURAL_FILING.test(title);
}

const SEP = /[\s、,，;；/·。：:（）()【】[\]「」+&]+/;

/** 从维度抽取关键词（key+watch 分词，去重、≥2 字），用于聚焦 AI 提示词。 */
export function dimensionKeywords(d: ThesisDimension): string[] {
  const toks = `${d.key} ${d.watch}`
    .split(SEP)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return [...new Set(toks)];
}

/** Gate 2（提示聚焦）：与新闻文本有关键词重叠的候选维度；为空表示无明显命中（此时可把全部维度交给 AI）。 */
export function candidateDimensions(
  dims: ThesisDimension[],
  text: string,
): ThesisDimension[] {
  return dims.filter((d) => dimensionKeywords(d).some((k) => text.includes(k)));
}

export type SignalOut = {
  dimensionKey: string;
  direction: "bull" | "bear" | "neutral";
  materiality: number;
  /** 展示用短句（= fact，保留给旧读路）。 */
  note: string;
  /** 客观事实：这条资讯里**已经发生**的可核查陈述（谁 / 何时 / 做了什么 / 多少）。 */
  fact: string;
  /** 为什么这条事实能验证该命题——**并且它证明不了什么**（局限）。 */
  why: string;
};

function extractJsonArray(raw: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fence ? fence[1]! : raw;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("signals: 未找到 JSON 数组");
  }
  return body.slice(start, end + 1);
}

const DIRECTIONS = new Set(["bull", "bear", "neutral"]);

/**
 * 解析 AI 输出的信号数组；只保留 dimensionKey ∈ validKeys、方向合法的条目，材料度夹到 0-100 整数。
 *
 * 2026-07-30：输出从「一句自由发挥的 note」改成「fact + why」两栏（张楚寒：现在这些「最新证据」
 * 很多并不是真正的证据）。**兼容旧形态**——只给了 note 的当作 fact，好让改版期间两种响应都能落库；
 * 但 fact 缺失的条目直接丢弃，因为没有事实就没有证据。
 */
export function parseSignals(raw: string, validKeys: string[]): SignalOut[] {
  const arr = JSON.parse(extractJsonArray(raw)) as unknown[];
  const keys = new Set(validKeys);
  const out: SignalOut[] = [];
  for (const item of arr) {
    const o = (item ?? {}) as Record<string, unknown>;
    const dimensionKey = typeof o.dimensionKey === "string" ? o.dimensionKey : "";
    const direction = typeof o.direction === "string" ? o.direction : "neutral";
    const note = typeof o.note === "string" ? o.note.trim() : "";
    const fact = (typeof o.fact === "string" ? o.fact.trim() : "") || note;
    const why = typeof o.why === "string" ? o.why.trim() : "";
    const m = Number(o.materiality);
    if (!keys.has(dimensionKey) || !DIRECTIONS.has(direction) || !fact) continue;
    out.push({
      dimensionKey,
      direction: direction as SignalOut["direction"],
      materiality: Math.max(0, Math.min(100, Math.round(Number.isFinite(m) ? m : 0))),
      note: fact,
      fact,
      why,
    });
  }
  return out;
}
