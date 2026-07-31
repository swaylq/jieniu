import { describe, it, expect } from "vitest";
import {
  baseFilter,
  selectOpportunities,
  MAX_SECTORS,
  MAX_STOCKS_PER_SECTOR,
  MAX_TOTAL,
  MIN_AVG_AMOUNT_20,
  type StockBasics,
  type SectorPick,
  type StockPick,
} from "./select";

const OKAY: StockBasics = {
  name: "赛微电子(300456)",
  barCount: 60,
  avgAmount20: 5e8,
  suspended: false,
  oneWordLimitUp: false,
  priceGapAnomaly: false,
};

describe("baseFilter（§5 基础过滤）", () => {
  it("正常股通过", () => {
    expect(baseFilter(OKAY).ok).toBe(true);
  });

  it("ST / *ST / 退市整理 一律排除", () => {
    expect(baseFilter({ ...OKAY, name: "ST阳光(600220)" }).ok).toBe(false);
    expect(baseFilter({ ...OKAY, name: "*ST模塑(000700)" }).ok).toBe(false);
    expect(baseFilter({ ...OKAY, name: "退市海润(600401)" }).ok).toBe(false);
  });

  it("名字里含「ST」的正常公司不能被误杀", () => {
    // 反例护栏：真库里有「东software」这类，但更现实的是含 ST 字母的英文名
    expect(baseFilter({ ...OKAY, name: "TCL科技(000100)" }).ok).toBe(true);
    expect(baseFilter({ ...OKAY, name: "STO顺丰控股(002352)" }).ok).toBe(true);
  });

  it("上市不足 60 个交易日排除（历史行数不够）", () => {
    const r = baseFilter({ ...OKAY, barCount: 30 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("上市");
  });

  it("20 日均成交额低于 1 亿排除", () => {
    expect(baseFilter({ ...OKAY, avgAmount20: 0.9e8 }).ok).toBe(false);
    expect(baseFilter({ ...OKAY, avgAmount20: 1.01e8 }).ok).toBe(true);
    expect(MIN_AVG_AMOUNT_20).toBe(1e8);
  });

  it("停牌 / 一字涨停 / 除权复牌类机械异动 排除", () => {
    expect(baseFilter({ ...OKAY, suspended: true }).ok).toBe(false);
    expect(baseFilter({ ...OKAY, oneWordLimitUp: true }).ok).toBe(false);
    expect(baseFilter({ ...OKAY, priceGapAnomaly: true }).ok).toBe(false);
  });

  it("成交额缺失当作不达标——「没量到」不能当放行理由", () => {
    expect(baseFilter({ ...OKAY, avgAmount20: null }).ok).toBe(false);
  });
});

function sector(name: string, score: number): SectorPick {
  return { key: name, sector: name, score };
}
function stock(ticker: string, sec: string, score: number): StockPick {
  return { key: ticker, ticker, sector: sec, score, companyKey: `C-${ticker}` };
}

describe("selectOpportunities（§1 每日上限）", () => {
  it("行业最多 3 个，按分数取高的", () => {
    const r = selectOpportunities(
      [sector("A", 90), sector("B", 85), sector("C", 80), sector("D", 79)],
      [],
    );
    expect(r.sectors.map((s) => s.sector)).toEqual(["A", "B", "C"]);
    expect(MAX_SECTORS).toBe(3);
  });

  it("同一行业最多 2 只个股", () => {
    const r = selectOpportunities(
      [sector("A", 90)],
      [
        stock("1", "A", 88),
        stock("2", "A", 87),
        stock("3", "A", 86),
        stock("4", "A", 85),
      ],
    );
    expect(r.stocks).toHaveLength(2);
    expect(MAX_STOCKS_PER_SECTOR).toBe(2);
  });

  it("总数不超过 8 —— 行业先占位，剩下的额度给个股", () => {
    const sectors = [sector("A", 99), sector("B", 98), sector("C", 97)];
    const stocks = ["A", "B", "C", "D", "E"].flatMap((s, i) => [
      stock(`${s}1`, s, 90 - i),
      stock(`${s}2`, s, 89 - i),
    ]);
    const r = selectOpportunities(sectors, stocks);
    expect(r.sectors.length + r.stocks.length).toBe(MAX_TOTAL);
    expect(MAX_TOTAL).toBe(8);
  });

  it("同一家公司不因 COMPANY / STOCK 两个实体重复出现（§12.8）", () => {
    const dup = [
      stock("600519", "A", 90),
      { ...stock("600519B", "A", 89), companyKey: "C-600519" },
    ];
    const r = selectOpportunities([sector("A", 90)], dup);
    expect(r.stocks).toHaveLength(1);
  });

  it("没有任何合格信号时返回空——不降标准凑数", () => {
    const r = selectOpportunities([], []);
    expect(r.sectors).toEqual([]);
    expect(r.stocks).toEqual([]);
  });

  it("逆势走强的个股允许来自未入选行业（它按定义就在弱势行业里）", () => {
    const r = selectOpportunities(
      [sector("A", 90)],
      [{ ...stock("9", "Z", 80), fromUnselectedSector: true }],
    );
    expect(r.stocks.map((s) => s.ticker)).toEqual(["9"]);
  });
});

describe("selectOpportunities — 名额优先级", () => {
  it("入选行业的代表股优先于逆势走强，哪怕后者分更高（§5：个股原则上从已入选行业里选）", () => {
    const r = selectOpportunities(
      [sector("A", 90), sector("B", 88), sector("C", 86)],
      [
        { ...stock("rs1", "Z", 99), fromUnselectedSector: true },
        { ...stock("rs2", "Y", 98), fromUnselectedSector: true },
        { ...stock("rs3", "X", 97), fromUnselectedSector: true },
        { ...stock("rs4", "W", 96), fromUnselectedSector: true },
        { ...stock("rs5", "V", 95), fromUnselectedSector: true },
        { ...stock("rs6", "U", 94), fromUnselectedSector: true },
        stock("a1", "A", 70),
        stock("b1", "B", 69),
      ],
    );
    expect(r.stocks.map((s) => s.ticker)).toContain("a1");
    expect(r.stocks.map((s) => s.ticker)).toContain("b1");
    expect(r.stocks).toHaveLength(5);
  });

  it("代表股不够时，逆势走强补上剩余名额", () => {
    const r = selectOpportunities(
      [sector("A", 90)],
      [stock("a1", "A", 80), { ...stock("rs1", "Z", 70), fromUnselectedSector: true }],
    );
    expect(r.stocks.map((s) => s.ticker)).toEqual(["a1", "rs1"]);
  });
});
