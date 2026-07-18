import { describe, it, expect } from "vitest";
import { matchNav, NAV_COMMANDS } from "./command-nav";

describe("matchNav", () => {
  it("returns all commands for an empty query (launcher default)", () => {
    expect(matchNav("")).toEqual(NAV_COMMANDS);
    expect(matchNav("   ")).toEqual(NAV_COMMANDS);
  });
  it("matches by Chinese label (P5-13: 机会 / 自选)", () => {
    expect(matchNav("机会").map((n) => n.href)).toEqual(["/discover"]);
    expect(matchNav("自选").map((n) => n.href)).toEqual(["/feed"]);
  });
  it("still finds renamed items by their old pinyin/english mnemonics", () => {
    // 发现→机会、关注→自选 后，旧助记词仍可搜到（不打断用户肌肉记忆）
    expect(matchNav("fx").map((n) => n.href)).toEqual(["/discover"]);
    expect(matchNav("faxian").map((n) => n.href)).toEqual(["/discover"]);
    expect(matchNav("gz").map((n) => n.href)).toEqual(["/feed"]);
    expect(matchNav("guanzhu").map((n) => n.href)).toEqual(["/feed"]);
    expect(matchNav("profile").map((n) => n.href)).toEqual(["/profile"]);
  });
  it("returns nothing for an unmatched query", () => {
    expect(matchNav("zzz")).toEqual([]);
  });
});
