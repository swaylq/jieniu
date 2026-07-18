import { describe, it, expect } from "vitest";
import {
  PRIMARY_NAV,
  NOTIFICATION_NAV,
  isNavActive,
} from "./nav";

describe("nav (P5-13 导航语义)", () => {
  it("primary nav is 今日变化 / 机会雷达 / 自选 / 我的组合 with correct hrefs", () => {
    expect(PRIMARY_NAV.map((n) => n.label)).toEqual([
      "今日变化",
      "机会雷达",
      "自选",
      "我的组合",
    ]);
    expect(PRIMARY_NAV.map((n) => n.href)).toEqual([
      "/",
      "/discover",
      "/feed",
      "/profile",
    ]);
  });

  it("every primary item has a short label for the mobile tab-bar", () => {
    for (const n of PRIMARY_NAV) {
      expect(typeof n.short).toBe("string");
      expect(n.short!.length).toBeGreaterThan(0);
    }
  });

  it("keeps the product term '自选' (自选股监控), never the light '关注'", () => {
    expect(PRIMARY_NAV.some((n) => n.label === "自选")).toBe(true);
    expect(PRIMARY_NAV.some((n) => n.label === "关注")).toBe(false);
  });

  it("surfaces the 机会雷达 entry (P5-4) and drops the vague 发现 label", () => {
    const opp = PRIMARY_NAV.find((n) => n.label === "机会雷达");
    expect(opp?.href).toBe("/discover");
    expect(PRIMARY_NAV.some((n) => n.label === "发现")).toBe(false);
  });

  it("keeps 通知 out of the primary nav (it renders as 提醒中心 reminder center)", () => {
    expect(PRIMARY_NAV.some((n) => n.href === "/notifications")).toBe(false);
    expect(NOTIFICATION_NAV.href).toBe("/notifications");
    expect(NOTIFICATION_NAV.label).toBe("提醒中心");
    expect(NOTIFICATION_NAV.icon).toBe("bell");
  });

  it("every nav item carries a known icon key", () => {
    const keys = new Set(["home", "compass", "star", "user", "bell"]);
    for (const n of [...PRIMARY_NAV, NOTIFICATION_NAV])
      expect(keys.has(n.icon)).toBe(true);
  });

  it("isNavActive: home matches only exact '/', others match by prefix", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/discover", "/")).toBe(false);
    expect(isNavActive("/feed", "/")).toBe(false);
    expect(isNavActive("/discover", "/discover")).toBe(true);
    expect(isNavActive("/discover/x", "/discover")).toBe(true);
    expect(isNavActive("/feed", "/discover")).toBe(false);
  });
});
