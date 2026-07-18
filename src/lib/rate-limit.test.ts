import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, clientIp, __resetRateLimitStore } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => __resetRateLimitStore());

  it("allows up to the limit within a window, then blocks", () => {
    const t = 1_000;
    expect(rateLimit("k", 2, 1_000, t)).toBe(true);
    expect(rateLimit("k", 2, 1_000, t)).toBe(true);
    expect(rateLimit("k", 2, 1_000, t)).toBe(false);
    expect(rateLimit("k", 2, 1_000, t)).toBe(false);
  });

  it("resets after the window elapses", () => {
    expect(rateLimit("k", 1, 1_000, 0)).toBe(true);
    expect(rateLimit("k", 1, 1_000, 500)).toBe(false); // still inside window
    expect(rateLimit("k", 1, 1_000, 1_000)).toBe(true); // window rolled over
  });

  it("keeps keys independent", () => {
    expect(rateLimit("a", 1, 1_000, 0)).toBe(true);
    expect(rateLimit("b", 1, 1_000, 0)).toBe(true);
    expect(rateLimit("a", 1, 1_000, 0)).toBe(false);
    expect(rateLimit("b", 1, 1_000, 0)).toBe(false);
  });

  it("a limit of 1 acts as a cooldown", () => {
    expect(rateLimit("cool", 1, 60_000, 0)).toBe(true);
    expect(rateLimit("cool", 1, 60_000, 59_999)).toBe(false);
    expect(rateLimit("cool", 1, 60_000, 60_000)).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    expect(
      clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })),
    ).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip then to 'unknown'", () => {
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
