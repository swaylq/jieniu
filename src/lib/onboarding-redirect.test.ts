import { describe, it, expect } from "vitest";

import { postLoginRedirect } from "./format";

describe("postLoginRedirect", () => {
  it("无明确来源（/）→ 引导页", () => {
    expect(postLoginRedirect("/")).toBe("/onboarding");
  });

  it("有明确来源 → 回来源页（意图优先）", () => {
    expect(postLoginRedirect("/entity/x")).toBe("/entity/x");
    expect(postLoginRedirect("/feed")).toBe("/feed");
    expect(postLoginRedirect("/onboarding")).toBe("/onboarding");
  });
});
