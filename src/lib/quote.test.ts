import { describe, it, expect } from "vitest";

import {
  tickerToSymbol,
  tickerToSecid,
  parseSinaQuote,
  parseSinaIndex,
  parseTencentQuote,
  parseValuation,
  hasValuation,
} from "./quote";

describe("tickerToSymbol", () => {
  it("maps A-share tickers to market symbols by leading digit", () => {
    expect(tickerToSymbol("688981")).toBe("sh688981");
    expect(tickerToSymbol("600000")).toBe("sh600000");
    expect(tickerToSymbol("000001")).toBe("sz000001");
    expect(tickerToSymbol("300750")).toBe("sz300750");
  });

  it("returns null for non-6-digit input", () => {
    expect(tickerToSymbol("abc")).toBeNull();
    expect(tickerToSymbol("12345")).toBeNull();
  });
});

describe("parseSinaQuote", () => {
  it("parses a live-shaped response and computes changePct", () => {
    const raw =
      'var hq_str_sh688981="中芯国际,86.00,80.00,88.00,89.00,85.50,x,x,2026-07-02,15:00:00,00";';
    const q = parseSinaQuote(raw);
    expect(q?.name).toBe("中芯国际");
    expect(q?.price).toBe(88);
    expect(q?.prevClose).toBe(80);
    expect(q?.changePct).toBeCloseTo(10, 5);
  });

  it("returns null for an empty payload (halted / unknown symbol)", () => {
    expect(parseSinaQuote('var hq_str_sh000000="";')).toBeNull();
  });
});

// 报文均为线上实抓（2026-07-23），三个市场字段布局完全不同，故必须分派解析。
describe("parseSinaIndex", () => {
  it("cn: computes changePct from prevClose (最新在第 3 位、昨收第 2 位)", () => {
    const raw =
      'var hq_str_sh000001="上证指数,3868.0871,3867.0336,3876.7774,3878.8318,3851.7058,0,0,562122601,1025875517700,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-07-23,15:30:36,00,";';
    const q = parseSinaIndex(raw, "cn");
    expect(q?.price).toBeCloseTo(3876.7774, 4);
    expect(q?.changePct).toBeCloseTo(0.2522, 3);
  });

  it("hk: takes 最新(第 6 位) 与 涨跌幅(第 8 位)", () => {
    const raw =
      'var hq_str_rt_hkHSI="HSI,恒生指数,24966.530,24892.660,25267.390,24876.830,25210.811,318.150,1.280,0.000,0.000,233480363.901,11416668992,0.000,0.000,28056.100,22518.000,2026/07/23,16:08:28,,,,,,";';
    const q = parseSinaIndex(raw, "hk");
    expect(q?.price).toBeCloseTo(25210.811, 3);
    expect(q?.changePct).toBeCloseTo(1.28, 2);
  });

  it("us: 涨跌幅接口直接给（第 2 位），不自算", () => {
    const raw =
      'var hq_str_gb_dji="道琼斯,52218.5781,-0.01,2026-07-23 04:43:46,-6.0600,52287.1406,52511.2109,52148.8711,53289.3008,43340.6797,449101175,459090077,0,0.00,--,0.00,0.00,0.00,0.00,0,0,0.0000,0.00,0.0000,,Jul 22 04:43PM EDT,52224.6406,0,1,2026";';
    const q = parseSinaIndex(raw, "us");
    expect(q?.price).toBeCloseTo(52218.5781, 4);
    expect(q?.changePct).toBeCloseTo(-0.01, 4);
  });

  it("用错市场布局会解析出错值——这正是不能共用 parseSinaQuote 的原因", () => {
    const us =
      'var hq_str_gb_dji="道琼斯,52218.5781,-0.01,2026-07-23 04:43:46,-6.0600";';
    // 按 cn 布局解析美股报文：会把「涨跌幅 -0.01」当成昨收 → 价格/涨跌幅全错
    expect(parseSinaIndex(us, "us")?.price).toBeCloseTo(52218.5781, 4);
    expect(parseSinaIndex(us, "cn")?.price).not.toBeCloseTo(52218.5781, 4);
  });

  it("空报文 / 字段不足返回 null（不抛）", () => {
    expect(parseSinaIndex('var hq_str_gb_dji="";', "us")).toBeNull();
    expect(parseSinaIndex('var hq_str_rt_hkHSI="HSI,恒生指数";', "hk")).toBeNull();
  });
});

describe("parseTencentQuote", () => {
  it("parses the tencent tilde-separated format", () => {
    const raw = 'v_sh688981="1~中芯国际~688981~88.00~80.00~86.00~x~x";';
    const q = parseTencentQuote(raw);
    expect(q?.name).toBe("中芯国际");
    expect(q?.price).toBe(88);
    expect(q?.changePct).toBeCloseTo(10, 5);
  });
});

describe("tickerToSecid", () => {
  it("maps A-share tickers to eastmoney secid (SH=1., SZ/ChiNext/BSE=0.)", () => {
    expect(tickerToSecid("600519")).toBe("1.600519");
    expect(tickerToSecid("000001")).toBe("0.000001");
    expect(tickerToSecid("300750")).toBe("0.300750");
    expect(tickerToSecid("830799")).toBe("0.830799");
  });
  it("returns null for non-6-digit input", () => {
    expect(tickerToSecid("60051")).toBeNull();
    expect(tickerToSecid("HK00700")).toBeNull();
  });
});

describe("parseValuation", () => {
  it("scales real eastmoney push2 fields (贵州茅台)", () => {
    // 实抓样本：f162=1445 f167=668 f116=1575090316443.99 f117=同 f168=36
    const v = parseValuation({
      f162: 1445,
      f167: 668,
      f116: 1575090316443.99,
      f117: 1575090316443.99,
      f168: 36,
    });
    expect(v.pe).toBeCloseTo(14.45, 2);
    expect(v.pb).toBeCloseTo(6.68, 2);
    expect(v.marketCap).toBeCloseTo(1575090316443.99, 0);
    expect(v.floatCap).toBeCloseTo(1575090316443.99, 0);
    expect(v.turnover).toBeCloseTo(0.36, 2);
  });

  it("nulls non-positive / non-finite PE, PB, cap (亏损/停牌/缺失)", () => {
    const v = parseValuation({ f162: -1230, f167: 0, f116: "-", f117: undefined, f168: 12 });
    expect(v.pe).toBeNull(); // 亏损 PE 不展示
    expect(v.pb).toBeNull();
    expect(v.marketCap).toBeNull();
    expect(v.floatCap).toBeNull();
    expect(v.turnover).toBeCloseTo(0.12, 2); // 换手率允许小正值
  });

  it("allows zero turnover but returns all-null for empty data", () => {
    expect(parseValuation({ f168: 0 }).turnover).toBe(0);
    const empty = parseValuation(null);
    expect(empty).toEqual({ pe: null, pb: null, marketCap: null, floatCap: null, turnover: null });
  });
});

describe("hasValuation", () => {
  it("is false only when every displayable metric is null", () => {
    expect(hasValuation(parseValuation(null))).toBe(false);
    expect(hasValuation(parseValuation({ f168: 0 }))).toBe(true); // 有换手率
    expect(hasValuation(parseValuation({ f167: 668 }))).toBe(true); // 有 PB
  });
});
