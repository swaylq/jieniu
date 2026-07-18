import { describe, it, expect } from "vitest";

import { resolveInitialTheme } from "./theme";

describe("resolveInitialTheme", () => {
  it("honors an explicit stored value", () => {
    expect(resolveInitialTheme("dark", false)).toBe("dark");
    expect(resolveInitialTheme("light", true)).toBe("light");
  });
  it("falls back to system preference otherwise", () => {
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme(null, false)).toBe("light");
    expect(resolveInitialTheme("garbage", true)).toBe("dark");
  });
});
