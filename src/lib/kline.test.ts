import { describe, it, expect } from "vitest";
import { parseEastmoneyKlines, parseSinaKlines } from "./kline";

describe("parseEastmoneyKlines", () => {
  const raw = {
    data: {
      klines: ["2026-04-20,1382.87,0.26", "2026-04-21,1383.99,0.08", "2026-04-22,1381.48,-0.18"],
    },
  };

  it("解析「日期,收盘,涨跌幅」三段式", () => {
    const bars = parseEastmoneyKlines(raw);
    expect(bars).toHaveLength(3);
    expect(bars[0]).toEqual({ day: "2026-04-20", close: 1382.87, changePct: 0.26 });
    expect(bars[2]!.changePct).toBe(-0.18);
  });

  it("结构不对返回空数组，不抛", () => {
    expect(parseEastmoneyKlines(null)).toEqual([]);
    expect(parseEastmoneyKlines({})).toEqual([]);
    expect(parseEastmoneyKlines({ data: { klines: "x" } })).toEqual([]);
  });

  it("跳过字段不全或非数字的行", () => {
    const bars = parseEastmoneyKlines({
      data: { klines: ["2026-04-20,1382.87,0.26", "坏行", "2026-04-21,abc,0.1"] },
    });
    expect(bars).toHaveLength(1);
  });

  it("按日期升序排好——下游按序取次日，顺序不能靠源保证", () => {
    const bars = parseEastmoneyKlines({
      data: { klines: ["2026-04-22,3,0.1", "2026-04-20,1,0.2"] },
    });
    expect(bars.map((b) => b.day)).toEqual(["2026-04-20", "2026-04-22"]);
  });
});

describe("parseSinaKlines", () => {
  const raw = [
    { day: "2026-07-21", close: "1308.000" },
    { day: "2026-07-22", close: "1305.000" },
    { day: "2026-07-23", close: "1292.010" },
  ];

  it("由相邻收盘价推算涨跌幅——新浪不给这个字段", () => {
    const bars = parseSinaKlines(raw);
    expect(bars).toHaveLength(3);
    expect(bars[1]!.changePct).toBeCloseTo(-0.23, 2); // 1305/1308-1
    expect(bars[2]!.changePct).toBeCloseTo(-1.0, 1);
  });

  it("首根没有前收，涨跌幅记 0——不编", () => {
    expect(parseSinaKlines(raw)[0]!.changePct).toBe(0);
  });

  it("非数组 / 坏行返回空或跳过", () => {
    expect(parseSinaKlines(null)).toEqual([]);
    expect(parseSinaKlines([{ day: "x" }])).toEqual([]);
  });
});
