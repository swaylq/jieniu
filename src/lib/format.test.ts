import { describe, it, expect } from "vitest";
import {
  entityTypeLabel,
  sourceTierLabel,
  streamStamp,
  formatMarketCap,
  isNotifiable,
  notifyWindowStart,
  NOTIFY_WINDOW_DAYS,
} from "./format";

describe("formatMarketCap", () => {
  it("formats yuan into 万亿/亿/万 buckets", () => {
    expect(formatMarketCap(1575090316443.99)).toBe("1.58 万亿");
    expect(formatMarketCap(2e10)).toBe("200 亿"); // ≥100亿 取整
    expect(formatMarketCap(5.3e9)).toBe("53.0 亿"); // <100亿 保留一位
    expect(formatMarketCap(8.5e11)).toBe("8500 亿");
    expect(formatMarketCap(5e6)).toBe("500 万");
  });
  it("returns 「—」 for null / non-positive / non-finite", () => {
    expect(formatMarketCap(null)).toBe("—");
    expect(formatMarketCap(0)).toBe("—");
    expect(formatMarketCap(NaN)).toBe("—");
  });
});

describe("streamStamp", () => {
  const now = new Date("2026-07-04T15:00:00");
  it("shows HH:MM for same-day items", () => {
    expect(streamStamp(new Date("2026-07-04T09:07:00"), now)).toBe("09:07");
  });
  it("shows MM-DD HH:MM for cross-day items", () => {
    expect(streamStamp(new Date("2026-07-02T18:30:00"), now)).toBe("07-02 18:30");
  });
});

describe("entityTypeLabel", () => {
  it("maps entity types to Chinese labels", () => {
    expect(entityTypeLabel("SECTOR")).toBe("板块");
    expect(entityTypeLabel("COMPANY")).toBe("公司");
    expect(entityTypeLabel("STOCK")).toBe("股票");
    expect(entityTypeLabel("PERSON")).toBe("人物");
  });
});

describe("sourceTierLabel", () => {
  it("maps source tiers to Chinese labels", () => {
    expect(sourceTierLabel("PRIMARY")).toBe("一手");
    expect(sourceTierLabel("MEDIA")).toBe("媒体");
    expect(sourceTierLabel("DERIVED")).toBe("衍生");
  });
});

describe("isNotifiable（历史回填闸门）", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it("窗口起点就是 now - NOTIFY_WINDOW_DAYS 天", () => {
    expect(notifyWindowStart(now).getTime()).toBe(
      daysAgo(NOTIFY_WINDOW_DAYS).getTime(),
    );
  });

  it("近期发布的资讯可以进提醒", () => {
    expect(isNotifiable(daysAgo(0), now)).toBe(true);
    expect(isNotifiable(daysAgo(NOTIFY_WINDOW_DAYS - 1), now)).toBe(true);
  });

  it("一年前回填进来的公告永远进不了提醒", () => {
    expect(isNotifiable(daysAgo(365), now)).toBe(false);
    expect(isNotifiable(daysAgo(NOTIFY_WINDOW_DAYS + 1), now)).toBe(false);
  });
});
