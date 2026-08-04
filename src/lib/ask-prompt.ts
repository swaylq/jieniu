// 「问解牛」持续对话的提示词拼装（纯函数，便于单测）。
//
// 与单轮那版（`server/ai.ts:askUserPrompt`）的差别只有一处：多了一段对话记录。
// 历史怎么截断见 `lib/ask-history`。

import { transcript, type AskTurn } from "./ask-history";

export type AskPromptInput = {
  question: string;
  /** 四层记忆渲染出的文本（`buildAskContext().contextText`）。 */
  context: string;
  hasMemory: boolean;
  /** 已截断的历史，按时间正序；空数组表示这是第一轮。 */
  history: AskTurn[];
  /** 事实段（`renderAskFacts()`），空串＝这一轮没查到任何可引用的事实。 */
  facts?: string;
  /** 认出来的主体公司名；空＝没认出他在问哪家公司。 */
  subjects?: string[];
};

/**
 * 作答口径。**这一段是 2026-08-04 那条反馈的正面修复**——
 * 原来只有一句「务必结合用户记忆里的持仓/逻辑作答」，于是用户问「麒盛科技为什么利润降这么多」
 * 这种**纯事实问题**时，模型被迫拿他自选里的美光/上海电力去套智能床，最后让他自己补数据。
 * 那不是模型偷懒，是我们逼它这么答的：把「个性化」写成了「必须个性化」。
 *
 * 现在分三种情形，顺序有意为之——**先回答问题，再谈他的组合**：
 */
export function answerStance(
  hasFacts: boolean,
  hasMemory: boolean,
  noSubject: boolean,
): string {
  const parts: string[] = [];
  if (hasFacts) {
    parts.push(
      "回答**事实性问题时必须先用【可引用的事实】里的原文**，并在每条结论句末标出处编号（如 `[1]`）；" +
        "事实里没有的原因、数字、时间，一个字都不要编。",
    );
  } else if (noSubject) {
    // 措辞刻意留了余地：「今天大盘怎么样」这种市场级问题也会走到这条分支（它本来就不问某家公司），
    // 一上来就问「你指哪只标的」是很烦的。所以由模型按问题本身判断，而不是我们硬分类。
    parts.push(
      "解牛这次没有取到任何公司事实。如果他问的是**某家具体公司**而你不确定是哪一家，" +
        "先说明这一点、请他补一句是哪只标的（或从个股页点「问解牛这条」再问）；" +
        "如果他问的是市场 / 板块 / 通用问题，就正常回答，但**只讲你有把握的常识，不要编具体数字与事件**。",
    );
  } else {
    parts.push(
      "**解牛收录的资料里这次没有查到相关事实**——先如实说这一点，可以建议他看原文或补充记录，" +
        "但**绝不要编一个原因出来**，也不要把问题推回去让他自己找答案。",
    );
  }
  if (!noSubject) {
    parts.push(
      hasMemory
        ? "如果这个问题**确实跟他的持仓或投资逻辑有关**，再补一段说说对他意味着什么；" +
            "**如果无关，就直接把问题本身回答完，不要硬套他的持仓框架，也不要反过来要求他补充资料**。"
        : "他还没有记录持仓或投资逻辑，回答完问题本身后，可以在结尾简短地" +
            "**建议他先在解牛里记录持仓与投资逻辑**，这样以后能得到结合他自己情况的回答。",
    );
  }
  // 这一句任何分支都要有：护栏不能因为走了哪条岔路就消失。
  parts.push("记忆里没有的信息不要编，事实里没有的也一样。");
  return parts.join("");
}

export function askConversationPrompt(i: AskPromptInput): string {
  const past = transcript(i.history);
  const facts = i.facts?.trim() ?? "";
  const subjects = i.subjects ?? [];
  return `【用户记忆】
${i.context}
${facts ? `\n${facts}\n` : ""}${past ? `\n【最近的对话】\n${past}\n` : ""}
【用户的问题】
${i.question}

请用简体中文回答。用 Markdown：开头先用「## 一句话看懂」给 1-2 条极短结论（每条一句），再按需用「## 」小标题分段、要点用「- 」。${answerStance(
    facts.length > 0,
    i.hasMemory,
    // 只有**真的跑过主体识别、却一个都没认出来**时才走「不知道你在问谁」那条口径。
    // 没传 subjects（老调用方 / 不做识别的路径）不等于识别失败，否则会把正常提问一律怼回去。
    Array.isArray(i.subjects) && subjects.length === 0 && !facts,
  )}${
    past
      ? "这是一段持续的对话——「这个」「它」这类指代请顺着上面的对话理解，别当成新问题重新起头。"
      : ""
  }`;
}
