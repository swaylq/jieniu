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
};

export function askConversationPrompt(i: AskPromptInput): string {
  const past = transcript(i.history);
  return `【用户记忆】
${i.context}
${past ? `\n【最近的对话】\n${past}\n` : ""}
【用户的问题】
${i.question}

请用简体中文回答。用 Markdown：开头先用「## 一句话看懂」给 1-2 条极短结论（每条一句），再按需用「## 」小标题分段、要点用「- 」。${
    i.hasMemory
      ? "务必结合上面「用户记忆」里的持仓 / 逻辑作答，指明你参考了他的哪些持仓或逻辑。"
      : "他还没有记录持仓或投资逻辑，只能一般性地回答，并在结尾**建议他先在解牛里记录持仓与投资逻辑**，这样以后能得到结合他自己情况的回答。"
  }${
    past
      ? "这是一段持续的对话——「这个」「它」这类指代请顺着上面的对话理解，别当成新问题重新起头。"
      : ""
  }记忆里没有的信息不要编。`;
}
