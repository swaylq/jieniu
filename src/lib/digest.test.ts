import { describe, it, expect } from "vitest";
import { digestSince, digestCaption, DIGEST_WINDOW_HOURS } from "./digest";

describe("digestSince", () => {
  it("returns a time exactly DIGEST_WINDOW_HOURS before now", () => {
    const now = new Date("2026-07-03T22:00:00.000Z");
    const since = digestSince(now);
    expect(now.getTime() - since.getTime()).toBe(
      DIGEST_WINDOW_HOURS * 60 * 60 * 1000,
    );
  });
});

describe("digestCaption", () => {
  it("reflects the shown count, not an inflated total", () => {
    expect(digestCaption(6)).toBe("近 24 小时 · 重磅 Top 6");
    expect(digestCaption(1)).toBe("近 24 小时 · 重磅 Top 1");
  });
});
