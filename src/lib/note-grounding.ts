// 归因的事实核对（2026-08-03，潞与张楚寒的第二轮）。相对导入、无 IO、可测。
//
// 现场：国盾量子的归因写「**光量子赛道**新股密集上市，公司作为产业链龙头或受益于行业关注度提升」。
// 张楚寒：「哪里有光量子新股」「不知道这个咋来的」。全库近 7 天「光量子」出现 **0 次**。
// 造词过程可以逐字复原——两篇文章各取一半：「A股"**光**"和"芯"新股都来了」＋「发力**量子**与半导体赛道」。
// 「新股都来了」（其实是两只新股**申购**）被写成「新股密集**上市**」，
// 而「产业链龙头」是摘要里形容国盾量子**作为客户**的说法。
//
// 这不是幻觉，是**跨文档缝合**：每个碎片都能在输入里找到，拼起来却是一件没发生过的事。
// 已有的判据全都拦不住它——有事实垫底、不循环归因、有事实锚点（「新股」在事件词表里）。
//
// 先试过一把纯词法的尺子（「赛道/概念名必须在原文出现过」），在 528 段线上真实文字上实测：
// **35 条误判、真阳性 0**。根因是中文里修饰词的左边界切不干净——「关注半导体板块」会被取成
// 「关注半导体」、「若半导体板块」取成「若半导体」，而能出现在名词前面的动词/副词是开集，
// 排除表永远补不完；一旦放松成「取任意右对齐子串」，「光量子」又会因为「量子」在原文里而漏掉。
// 词法解不了语义问题，那把尺子已经删掉。
//
// 这里换成**逐条核对**：把归因和它所依据的事实一起交给便宜模型，只问一个封闭问题——
// 「这句话里的每个说法，在事实里有没有依据」。它不评价对错、不做投资判断，只做有据/无据，
// 所以不违反「AI 打的分不能给 AI 背书」那条（那条针对的是拿模型去认证「已验证」状态）。
//
// 三条设计约束：
//   ① **一次调用核完一份复盘的所有归因**——按条调用会把成本和时延放大一个量级；
//   ② **失败一律放行**（模型挂了/返回不可解析 → 保留原文），核查是加固不是关卡，
//      绝不能因为核查器抽风就把整份复盘弄空；
//   ③ **判否只留空那一条 note**，不判废整份——同 digest-substance 的既有立场。

export type GroundingItem = {
  /** 这条归因说的是谁（公司名 / 板块名） */
  subject: string;
  /** 它被允许依据的事实（就是喂给写作模型的那几条） */
  facts: string[];
  /** 待核对的归因原文 */
  note: string;
};

export type GroundingVerdict = { ok: boolean; why: string };

export const GROUNDING_SYSTEM = `你是事实核查员。给你若干条【归因】和它各自被允许依据的【事实】，
你只做一件事：判断这条归因里的说法，是不是**都能在它自己的事实里找到依据**。

判 no 的情形（有一条即 no）：
1. **生造名词**——事实里没有这个赛道/概念/产品/机构名，是把两处的词拼出来的
   （事实说「"光"和"芯"新股」＋「量子与半导体赛道」，归因写「光量子赛道」→ no）。
2. **事实里没说的事**——事实没提的事件、数字、时间、因果。
3. **张冠李戴**——把别家公司的事说成这家公司的事；事实里这家公司只是被顺带提到（客户、供应商、
   同行、参股方），却被写成它自己发生的事。
4. **改变事实的程度或阶段**——「申报/过会/申购」写成「上市」，「拟」写成「已」，
   「一两只」写成「密集/大量」，「计划」写成「完成」。

判 yes 的情形：
- 说法是对事实的**转述或归纳**，哪怕换了词、更概括、省略了数字；
- 归因合并了**多条**事实，只要每一处分别都能对上其中某一条；
- **把事实和当天涨跌连起来的因果表述**（「受…影响下跌」「…带动走强」）——归因这个位置本来就是
  要解释「今天为什么这样走」，只要被引用的事实本身没被改写，因果说法算 yes。

**方向别搞反**：只查「归因里有没有事实之外的东西」。事实里有而归因没写的，是正常取舍，不判 no。

**只看有没有依据，不评价这个判断对不对、合不合理，也不管文笔。**
拿不准就判 yes——这道核查是用来抓明显编造的，不是用来挑刺的。

只输出一个 JSON 对象，不要解释文字或 markdown 围栏：
{"verdicts":[{"i":1,"ok":true,"why":""},{"i":2,"ok":false,"why":"事实里没有「光量子」这个说法"}]}
why 只在 ok=false 时写，一句话，20 字以内。`;

export function buildGroundingPrompt(items: GroundingItem[]): string {
  return items
    .map((it, idx) => {
      const facts =
        it.facts.length > 0
          ? it.facts.map((f) => `     - ${f}`).join("\n")
          : "     （无）";
      return `${idx + 1}. 标的：${it.subject}\n   事实：\n${facts}\n   归因：${it.note}`;
    })
    .join("\n\n");
}

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
 * 解析核查结果。**没提到的条目一律当通过**——核查器漏答不该变成内容被删
 * （同「兜底一律放行」，见文件头约束②）。返回长度与 `count` 一致。
 */
export function parseGroundingResponse(raw: string, count: number): GroundingVerdict[] {
  const pass = (): GroundingVerdict[] =>
    Array.from({ length: count }, () => ({ ok: true, why: "" }));
  const j = extractJson(raw);
  if (!j || typeof j !== "object") return pass();
  const arr = (j as Record<string, unknown>).verdicts;
  if (!Array.isArray(arr)) return pass();
  const out = pass();
  for (const raw1 of arr) {
    if (!raw1 || typeof raw1 !== "object") continue;
    const o = raw1 as Record<string, unknown>;
    const i = typeof o.i === "number" ? o.i : Number(o.i);
    if (!Number.isInteger(i) || i < 1 || i > count) continue;
    // 只认显式的 false；缺字段、非布尔一律当通过
    if (o.ok === false) {
      out[i - 1] = {
        ok: false,
        why: typeof o.why === "string" ? o.why.trim().slice(0, 40) : "",
      };
    }
  }
  return out;
}
