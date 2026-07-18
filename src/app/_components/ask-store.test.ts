import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  registerAskHandler,
  hasAskHandler,
  emitAsk,
} from "./ask-store";

describe("ask-store", () => {
  beforeEach(() => {
    // 每例先清空 handler（注册再注销）
    const off = registerAskHandler(vi.fn());
    off();
  });

  it("无 handler 时 has=false、emit 返回 false（未登录 → 调用方跳登录）", () => {
    expect(hasAskHandler()).toBe(false);
    expect(emitAsk("hi")).toBe(false);
  });

  it("注册后 emit 调用 handler 并返回 true", () => {
    const spy = vi.fn();
    registerAskHandler(spy);
    expect(hasAskHandler()).toBe(true);
    expect(emitAsk("你好")).toBe(true);
    expect(spy).toHaveBeenCalledWith("你好");
  });

  it("注销后回到无 handler 态", () => {
    const off = registerAskHandler(vi.fn());
    off();
    expect(hasAskHandler()).toBe(false);
    expect(emitAsk("x")).toBe(false);
  });
});
