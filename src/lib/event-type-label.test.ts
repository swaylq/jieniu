import { describe, it, expect } from "vitest";

import { eventTypeLabel } from "./format";

describe("eventTypeLabel", () => {
  it("美化少数关键词", () => {
    expect(eventTypeLabel("处罚")).toBe("监管处罚");
    expect(eventTypeLabel("问询")).toBe("问询函");
    expect(eventTypeLabel("解禁")).toBe("限售解禁");
  });

  it("其余关键词原样返回", () => {
    expect(eventTypeLabel("重组")).toBe("重组");
    expect(eventTypeLabel("回购")).toBe("回购");
  });

  it("未知事件类型回退为原值", () => {
    expect(eventTypeLabel("外星人登陆")).toBe("外星人登陆");
  });
});
