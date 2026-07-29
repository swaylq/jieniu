import { describe, it, expect } from "vitest";
import { shouldNotify, THROTTLE_MS } from "./notify";

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 29, 12, 0, 0);

describe("shouldNotify", () => {
  it("稳态成功不发信", () => {
    expect(
      shouldNotify({ status: "ok", alertCount: 0, lastNotifiedAtMs: null, nowMs: now }),
    ).toBe(false);
  });

  it("失败要发", () => {
    expect(
      shouldNotify({ status: "fail", alertCount: 0, lastNotifiedAtMs: null, nowMs: now }),
    ).toBe(true);
  });

  it("判据命中要发", () => {
    expect(
      shouldNotify({ status: "ok", alertCount: 2, lastNotifiedAtMs: null, nowMs: now }),
    ).toBe(true);
  });

  it("6 小时内已发过就不再发（同一个故障别刷屏）", () => {
    expect(
      shouldNotify({
        status: "fail",
        alertCount: 0,
        lastNotifiedAtMs: now - HOUR,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("超过 6 小时可以再发", () => {
    expect(
      shouldNotify({
        status: "fail",
        alertCount: 0,
        lastNotifiedAtMs: now - THROTTLE_MS - 1000,
        nowMs: now,
      }),
    ).toBe(true);
  });
});
