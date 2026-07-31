import { describe, it, expect } from "vitest";
import {
  aggregateSector,
  marketBenchmark,
  isLimitUp,
  sectorRankUp,
  atOffset,
  type StockSeries,
} from "./aggregate";
import type { RadarBar } from "./series";

/** 造一只股：`chg` 是逐日涨跌幅，收盘价由它推出来，净额可选。 */
function series(
  ticker: string,
  sector: string,
  chg: number[],
  nets: (number | null)[] = [],
  amounts: (number | null)[] = [],
): StockSeries {
  let close = 10;
  const bars: RadarBar[] = chg.map((c, i) => {
    close = close * (1 + c / 100);
    return {
      day: `2026-06-${String(i + 1).padStart(2, "0")}`,
      close: Math.round(close * 1e4) / 1e4,
      changePct: c,
      amount: amounts[i] ?? 2e8,
      netAmount: nets[i] ?? null,
      netRatio: null,
      turnoverRate: null,
    };
  });
  return { ticker, entityId: `e-${ticker}`, name: `股${ticker}`, sector, bars };
}

describe("isLimitUp（按板块判涨停阈值）", () => {
  it("主板 10cm、创业板/科创板 20cm、北交所 30cm", () => {
    expect(isLimitUp("600519", 9.9)).toBe(true);
    expect(isLimitUp("600519", 9.5)).toBe(false);
    expect(isLimitUp("300456", 9.9)).toBe(false);
    expect(isLimitUp("300456", 19.8)).toBe(true);
    expect(isLimitUp("688981", 19.8)).toBe(true);
    expect(isLimitUp("920123", 29.8)).toBe(true);
  });
});

describe("atOffset", () => {
  it("砍掉最后 k 根，用来回到 k 个交易日前", () => {
    const s = series("1", "A", [1, 2, 3, 4, 5]);
    expect(atOffset(s.bars, 2)).toHaveLength(3);
    expect(atOffset(s.bars, 0)).toHaveLength(5);
  });
});

describe("marketBenchmark（全 A 等权基准）", () => {
  it("N 日收益是全体个股 N 日收益的等权均值", () => {
    const all = [
      series("1", "A", [0, 1, 1, 1]),
      series("2", "B", [0, 3, 3, 3]),
    ];
    const m = marketBenchmark(all);
    // 每只股 3 日收益分别约 3.03% 和 9.27%，均值约 6.15%
    expect(m.ret3!).toBeGreaterThan(6);
    expect(m.ret3!).toBeLessThan(6.3);
  });

  it("历史不够的窗口返回 null，不用短样本冒充", () => {
    const m = marketBenchmark([series("1", "A", [1, 1])]);
    expect(m.ret20).toBeNull();
  });
});

describe("aggregateSector", () => {
  const flat = Array.from({ length: 25 }, () => 0);

  it("成分股太少不聚合——几只股的均值没有代表性", () => {
    expect(aggregateSector("小板块", [series("1", "A", flat)])).toBeNull();
  });

  it("上涨占比 / 涨停占比按今日算", () => {
    const members = [
      series("600001", "A", [...flat.slice(0, 24), 3]),
      series("600002", "A", [...flat.slice(0, 24), 9.9]),
      series("600003", "A", [...flat.slice(0, 24), -1]),
      series("600004", "A", [...flat.slice(0, 24), 0]),
      series("600005", "A", [...flat.slice(0, 24), 2]),
    ];
    const agg = aggregateSector("A", members)!;
    expect(agg.members).toBe(5);
    expect(agg.upShare).toBeCloseTo(3 / 5, 6);
    expect(agg.limitUpShare).toBeCloseTo(1 / 5, 6);
  });

  it("板块资金 = 成分股净额求和；持续性数最近 N 天板块净额为正的天数", () => {
    const nets = [1e7, -2e7, 3e7, 4e7, 5e7];
    const members = Array.from({ length: 5 }, (_, i) =>
      series(`60000${i}`, "A", [0, 0, 0, 0, 0], nets),
    );
    const agg = aggregateSector("A", members)!;
    expect(agg.netAmountToday).toBeCloseTo(5 * 5e7, 0);
    expect(agg.posFlowDays3).toBe(3);
    expect(agg.posFlowDays5).toBe(4);
  });

  it("资金集中度 = 前 N 只净流入 / 全部净流入（只算流入侧）", () => {
    const members = [
      series("600001", "A", [0], [9e7]),
      series("600002", "A", [0], [1e7]),
      series("600003", "A", [0], [0]),
      series("600004", "A", [0], [0]),
      series("600005", "A", [0], [-5e7]),
    ];
    const agg = aggregateSector("A", members)!;
    expect(agg.top2Concentration).toBeCloseTo(1, 6);
    expect(agg.top3Concentration).toBeCloseTo(1, 6);
  });

  it("股价在涨但资金连续 3 天流出 → 打上 priceUpFlowOut", () => {
    const members = Array.from({ length: 5 }, (_, i) =>
      series(`60000${i}`, "A", [1, 1, 1, 1, 1], [1e7, 1e7, -1e7, -2e7, -3e7]),
    );
    const agg = aggregateSector("A", members)!;
    expect(agg.priceUpFlowOut).toBe(true);
  });

  it("成分股历史长度不一时，各窗口只用够长的那些算，并报出覆盖数", () => {
    const members = [
      series("600001", "A", Array.from({ length: 25 }, () => 1)),
      series("600002", "A", Array.from({ length: 25 }, () => 1)),
      series("600003", "A", [1, 1]),
      series("600004", "A", [1, 1]),
      series("600005", "A", [1, 1]),
    ];
    const agg = aggregateSector("A", members)!;
    expect(agg.ret20).not.toBeNull();
    expect(agg.coverage20).toBe(2);
    expect(agg.ret3).not.toBeNull();
  });
});

describe("sectorRankUp（行业强弱排名的变化）", () => {
  it("3 日前排最后、今天排第一 → 上升 (n-1) 位", () => {
    const now = new Map([
      ["A", 5],
      ["B", 1],
      ["C", 0],
    ]);
    const then = new Map([
      ["A", -3],
      ["B", 2],
      ["C", 4],
    ]);
    expect(sectorRankUp("A", now, then)).toBe(2);
    expect(sectorRankUp("C", now, then)).toBe(-2);
  });

  it("缺任一侧数据返回 null", () => {
    expect(sectorRankUp("Z", new Map(), new Map())).toBeNull();
  });
});
