import { describe, it, expect } from "vitest";

import { toValidDate } from "./format";

describe("toValidDate", () => {
  it("透传合法的毫秒时间戳", () => {
    expect(toValidDate(1_700_000_000_000).getTime()).toBe(1_700_000_000_000);
  });

  it("透传合法日期字符串", () => {
    expect(toValidDate("2026-01-02T03:04:05Z").toISOString()).toBe(
      "2026-01-02T03:04:05.000Z",
    );
  });

  it("非法值回退到 fallback", () => {
    const fb = new Date("2020-01-01T00:00:00Z");
    expect(toValidDate(Number.NaN, fb)).toBe(fb);
    expect(toValidDate("not-a-date", fb)).toBe(fb);
  });
});
