import { describe, it, expect } from "vitest";
import { askConversationPrompt } from "./ask-prompt";

const base = {
  question: "它最近怎么样",
  context: "持仓：宁德时代",
  hasMemory: true,
};

describe("askConversationPrompt", () => {
  it("有历史时带上对话记录，并交代这是持续对话（否则「它」会被当新问题）", () => {
    const out = askConversationPrompt({
      ...base,
      history: [
        { role: "user", content: "宁德时代的逻辑是什么" },
        { role: "assistant", content: "……" },
      ],
    });
    expect(out).toContain("【最近的对话】");
    expect(out).toContain("用户：宁德时代的逻辑是什么");
    expect(out).toContain("持续的对话");
  });

  it("第一轮不出现对话段，也不提指代（免得凭空暗示有上文）", () => {
    const out = askConversationPrompt({ ...base, history: [] });
    expect(out).not.toContain("【最近的对话】");
    expect(out).not.toContain("持续的对话");
  });

  it("没有记忆时引导用户先记录，而不是硬答", () => {
    const out = askConversationPrompt({ ...base, hasMemory: false, history: [] });
    expect(out).toContain("建议他先在解牛里记录持仓与投资逻辑");
  });

  it("始终交代不许编造", () => {
    expect(askConversationPrompt({ ...base, history: [] })).toContain(
      "记忆里没有的信息不要编",
    );
  });
});
