// 「问解牛」的事实层（2026-08-04，Alley_Stella 直报 · 张楚寒转述）。相对导入、无 IO、可测。
//
// 现场：她拿自己公司（麒盛科技 603610）试，在个股新闻页点「问解牛这条」，然后追问
// 「为什么上半年利润降这么多」→「**新闻里没有说原因吗**」。系统答不出，只让她自己去补细节。
// 而她点的**那一条新闻**，摘要原文就写着：
//   「…同比减少66.97%至75.58%。2026年上半年业绩减少主要系受美元汇率波动影响，
//     本报告期汇兑损失增加。」
// 库里还有一条旁证（7-28「汇兑损失与费用投入增加 多家A股睡眠家居企业利润下滑」）。
// 她转去问 DeepSeek，DeepSeek 编了个「去年同期股权处置一次性收益、董秘说的」——和一手预告冲突。
//
// 根因不在模型，在**上下文里根本没有资讯这一层**：`AskMemory` 只有画像/持仓/逻辑/信号/决策，
// 全是用户自己的记忆，一条公司事实都没有。它不是「主要在看新闻」，是**完全没在看新闻**。
// 而「问解牛这条」只把**标题**拼进问题字符串，请求体里没有 newsId——恰恰把带着答案的那段摘要丢了。
//
// 这里补上事实层，并把「不能瞎编」做成机制而不是祈祷：
//   ① 每条事实带编号、日期、来源、层级，回答**必须标 [n] 出处**（用户一眼能核对，这是 DeepSeek 给不了的）；
//   ② 出处编号**机械校验**：引用了不存在的 [n] 就是编的；
//   ③ 带单位的数字必须在语料里出现过（沿用「数字由代码算、AI 只写文字」那条铁律）。

import { filingExcerpt, excerptIsEmpty } from "./filing-excerpt";

export type AskFact = {
  title: string;
  /** 正文优先、退回摘要；渲染前会走 `filingExcerpt` 剥掉公告法务套话 */
  body: string;
  /** PRIMARY=一手（公司公告/交易所），其余按媒体处理 */
  tier: string;
  sourceName: string;
  publishedAt: Date;
  url: string | null;
  /**
   * `own`＝这家公司自己的事（标题点名它，或权威体裁）；
   * `mention`＝只是在文中提到它（行业综述、同业对比）。
   *
   * 归因位上「提及」是要剔掉的（那正是国盾量子那条错归因的来源），但**问答不一样**：
   * 用户问「为什么利润降这么多」，一篇「多家睡眠家居企业利润下滑，汇兑损失是共性原因」
   * 是有用的旁证——只要**标清楚它不是这家公司自己说的**。同 evidence 层 direct/supporting 的分法。
   */
  kind: "own" | "mention";
};

export type AskFactsInput = {
  /** 用户正在看的那一条（点「问解牛这条」时有）——放最前面，且给更长的摘录 */
  focus: AskFact | null;
  facts: AskFact[];
  /** 这一轮认出来的主体（问题里提到的、或当前页面的公司） */
  subjects: string[];
};

const EXCERPT_MAX = 160;
const FOCUS_EXCERPT_MAX = 400;

function tierCn(tier: string): string {
  return tier === "PRIMARY" ? "一手" : "媒体";
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 一条事实的可用摘录。一手公告的 summary 常常就是标题本身（实测近 30 天 20886 条里 63% 如此），
 * 正文又只有 38% 抓得到——所以一律走 filingExcerpt 剥掉法务套话，**剥完是空壳就当没有**。
 * 实测不判空会渲染出「麒盛科技:」这种半截前缀，比不显示更糟：占着行、还像是有内容。
 */
export function usableExcerpt(f: AskFact, max: number): string {
  const ex = filingExcerpt(f.title, f.body, max);
  if (!ex || excerptIsEmpty(ex)) return "";
  // 摘录只是标题的**前缀**时同样等于没有：实测「宁德时代大宗交易：1笔共395万元」这条，
  // 摘出来是「宁德时代大宗交易：」——8 个字过了空判、却一个新信息都没有。
  const flat = (s: string) => s.replace(/\s/g, "");
  if (flat(f.title).startsWith(flat(ex))) return "";
  return ex;
}

function line(n: number, f: AskFact, max: number): string {
  const ex = usableExcerpt(f, max);
  const tag = f.kind === "mention" ? `${tierCn(f.tier)}·仅提及` : tierCn(f.tier);
  const head = `[${n}] ${ymd(f.publishedAt)} · ${tag} · ${f.sourceName} · ${f.title}`;
  return ex ? `${head}\n    ${ex}` : head;
}

/** 事实段。空事实返回空串——调用方据此改写提示词的口径（明说没查到，而不是让用户自己找）。 */
export function renderAskFacts(i: AskFactsInput): string {
  const all = i.focus ? [i.focus, ...i.facts] : i.facts;
  if (all.length === 0) return "";
  const lines = all.map((f, idx) =>
    line(idx + 1, f, idx === 0 && i.focus ? FOCUS_EXCERPT_MAX : EXCERPT_MAX),
  );
  const hasMention = all.some((f) => f.kind === "mention");
  const head = i.focus
    ? "【可引用的事实】（[1] 是他正在看的那一条）"
    : "【可引用的事实】";
  const note = hasMention
    ? "\n（标「仅提及」的那几条不是这家公司自己披露的，只是文中提到了它——引用时要说清这是同业/行业口径。）"
    : "";
  return `${head}${note}\n${lines.join("\n")}`;
}

/** 这一轮一共给了几条事实——出处编号的合法上界。 */
export function factCount(i: AskFactsInput): number {
  return (i.focus ? 1 : 0) + i.facts.length;
}

// ---------------------------------------------------------------------------
// 选材：哪几条跟这个问题有关
// ---------------------------------------------------------------------------

/**
 * 疑问句里没有信息量的词。中文没有空格，所以走二元组；这些二元组出现在任何问题里，
 * 拿它们去匹配等于没匹配。
 */
const STOP_BIGRAM = new Set([
  "为什", "什么", "为啥", "怎么", "么样", "这么", "那么", "么多", "多少", "如何",
  "是不", "不是", "有没", "没有", "可以", "能不", "为何", "哪些", "什時", "一下",
  "解释", "分析", "告诉", "帮我", "一个", "这个", "那个", "它的", "公司", "股票",
]);

/** 问题里的检索词（二元组）。中文分词太重，二元组够用且不引依赖。 */
export function questionTerms(q: string): string[] {
  const runs = q.match(/[一-鿿A-Za-z0-9]+/g) ?? [];
  const out: string[] = [];
  for (const run of runs) {
    if (/^[A-Za-z0-9]+$/.test(run)) {
      if (run.length >= 2 && !out.includes(run)) out.push(run);
      continue;
    }
    for (let i = 0; i + 2 <= run.length; i++) {
      const g = run.slice(i, i + 2);
      if (STOP_BIGRAM.has(g) || out.includes(g)) continue;
      out.push(g);
    }
  }
  return out;
}

/** 这条事实跟问题有多相关＝命中了几个检索词。标题里命中算双倍——标题才是它在讲什么。 */
export function relevanceScore(f: AskFact, terms: string[]): number {
  if (terms.length === 0) return 0;
  let n = 0;
  for (const t of terms) {
    if (f.title.includes(t)) n += 2;
    else if (f.body.includes(t)) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 校验：出处编号 与 数字
// ---------------------------------------------------------------------------

const CITATION = /\[(\d{1,2})\]/g;

/** 回答里引用了但根本不存在的出处编号。非空＝模型编了出处。 */
export function invalidCitations(answer: string, count: number): number[] {
  const bad: number[] = [];
  for (const m of answer.matchAll(CITATION)) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > count) {
      if (!bad.includes(n)) bad.push(n);
    }
  }
  return bad;
}

/**
 * 带单位的数字（「66.97%」「2580万元」「1.5倍」）。裸数字不查——
 * 「过去5年」「三家公司」这类是行文，不是财务事实，而且单字数字在任何语料里都能命中，查了也没鉴别力。
 */
const NUMBER_WITH_UNIT =
  /(\d[\d,，]*(?:\.\d+)?)\s*(%|％|个百分点|亿元|万元|亿|万|元|美元|港元|倍|bp|BP)/g;

/** 归一：去掉千分位，去掉小数末尾的 0（「2580.00万元」与「2580万元」要能对上）。 */
function normalizeNum(s: string): string {
  const plain = s.replace(/[,，]/g, "");
  return plain.includes(".") ? plain.replace(/0+$/, "").replace(/\.$/, "") : plain;
}

/**
 * 回答里出现、但语料里找不到的**带单位数字**。非空＝模型自己造了一个数。
 * 沿用复盘那条铁律的思路：数字只能来自事实，模型只负责写文字。
 */
export function ungroundedNumbers(answer: string, corpus: string): string[] {
  const hay = corpus.replace(/[,，]/g, "");
  const out: string[] = [];
  for (const m of answer.matchAll(NUMBER_WITH_UNIT)) {
    const raw = m[1] ?? "";
    const num = normalizeNum(raw);
    if (num.replace(/\D/g, "").length < 2) continue; // 一位数不查
    if (hay.includes(num)) continue;
    // 「2580.00」在语料里、回答写「2580」也算命中：反过来再比一次
    if (hay.includes(`${num}.`)) continue;
    const shown = `${raw}${m[2] ?? ""}`;
    if (!out.includes(shown)) out.push(shown);
  }
  return out;
}
