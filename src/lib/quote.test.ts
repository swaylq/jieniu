import { describe, it, expect } from "vitest";

import {
  tickerToSymbol,
  tickerToSecid,
  parseSinaQuote,
  parseSinaIndex,
  parseTencentQuote,
  parseValuation,
  parseTencentValuation,
  parseEastmoneyTicks,
  hasValuation,
  isAShareTicker,
} from "./quote";

describe("parseTencentValuation (push2 不可达时的估值兜底)", () => {
  it("extracts PE/PB/turnover/marketCap from the ~-delimited tencent quote", () => {
    // 腾讯 qt.gtimg：[38]换手% [39]市盈TTM [44]流通市值(亿) [45]总市值(亿) [46]市净率
    const f = Array<string>(47).fill("");
    f[0] = "1"; f[1] = "贵州茅台"; f[2] = "600519"; f[3] = "1297.41";
    f[38] = "0.29"; f[39] = "19.61"; f[44] = "16218.68"; f[45] = "16218.68"; f[46] = "6.96";
    const v = parseTencentValuation(`v_sh600519="${f.join("~")}";`);
    expect(v.pe).toBe(19.61);
    expect(v.pb).toBe(6.96);
    expect(v.turnover).toBe(0.29);
    // 亿元 → 元
    expect(v.marketCap).toBe(1621868000000);
    expect(v.floatCap).toBe(1621868000000);
  });

  it("returns all-null for an empty payload", () => {
    expect(parseTencentValuation('v_x="";')).toEqual({
      pe: null, pb: null, marketCap: null, floatCap: null, turnover: null,
    });
  });
});

describe("isAShareTicker (A股行情/披露规则适用性——美股/港股不适用)", () => {
  it("returns true for A-share tickers incl. 北交所 (leading 6/0/3/8/4)", () => {
    expect(isAShareTicker("600519")).toBe(true);
    expect(isAShareTicker("000001")).toBe(true);
    expect(isAShareTicker("300750")).toBe(true);
    expect(isAShareTicker("688981")).toBe(true);
    expect(isAShareTicker("833994")).toBe(true); // 北交所 8 开头（旧码）
    expect(isAShareTicker("920238")).toBe(true); // 北交所 920xxx 新代码段
    expect(isAShareTicker("920045")).toBe(true);
  });
  it("returns false for US tickers, HK codes, invalid, and null/undefined", () => {
    expect(isAShareTicker("NVDA")).toBe(false);
    expect(isAShareTicker("AMD")).toBe(false);
    expect(isAShareTicker("00700")).toBe(false); // 港股 5 位
    expect(isAShareTicker("")).toBe(false);
    expect(isAShareTicker(null)).toBe(false);
    expect(isAShareTicker(undefined)).toBe(false);
  });
});

describe("tickerToSymbol", () => {
  it("maps A-share tickers to market symbols by leading digit", () => {
    expect(tickerToSymbol("688981")).toBe("sh688981");
    expect(tickerToSymbol("600000")).toBe("sh600000");
    expect(tickerToSymbol("000001")).toBe("sz000001");
    expect(tickerToSymbol("300750")).toBe("sz300750");
    expect(tickerToSymbol("830799")).toBe("bj830799"); // 北交所旧码
    expect(tickerToSymbol("920238")).toBe("bj920238"); // 北交所 920xxx 新码
  });

  it("returns null for non-6-digit input", () => {
    expect(tickerToSymbol("abc")).toBeNull();
    expect(tickerToSymbol("12345")).toBeNull();
  });
});

describe("tickerToSecid", () => {
  it("maps A-share tickers to push2 secid (沪=1. 其余=0.)", () => {
    expect(tickerToSecid("600519")).toBe("1.600519");
    expect(tickerToSecid("000001")).toBe("0.000001");
    expect(tickerToSecid("830799")).toBe("0.830799"); // 北交所旧码
    expect(tickerToSecid("920238")).toBe("0.920238"); // 北交所 920xxx 新码
  });
  it("returns null for non-A-share", () => {
    expect(tickerToSecid("NVDA")).toBeNull();
    expect(tickerToSecid("00700")).toBeNull();
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

  it("cmdty: 用昨结算(第 7 位)自算，不用常为空的昨收(第 1 位)", () => {
    // 纽约黄金 hf_GC 线上实抓（2026-07-28）：第 1 位昨收是空串，只有昨结算 4136.400 可用。
    const raw =
      'var hq_str_hf_GC="4088.573,,4088.500,4089.100,4145.000,4088.300,17:51:06,4136.400,4142.000,0,1,1,2026-07-28,纽约黄金,0";';
    const q = parseSinaIndex(raw, "cmdty");
    expect(q?.price).toBeCloseTo(4088.573, 3);
    expect(q?.changePct).toBeCloseTo(-1.1562, 3);
  });

  it("cmdty: 昨结算缺失/为 0 返回 null，不吐出 Infinity 涨跌幅", () => {
    const noSettle =
      'var hq_str_hf_CL="80.628,,80.710,80.720,82.430,79.800,17:51:06,0,82.000,0,3,7,2026-07-28,纽约原油,0";';
    expect(parseSinaIndex(noSettle, "cmdty")).toBeNull();
    expect(
      parseSinaIndex('var hq_str_hf_CL="80.628,,80.710";', "cmdty"),
    ).toBeNull();
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


describe("parseTencentQuote 的最高/最低（新浪 403 之后腾讯是主源）", () => {
  it("reads high/low from fields 33/34", () => {
    // 腾讯串：[1]名称 [3]现价 [4]昨收 [5]今开 [33]最高 [34]最低
    const f = Array<string>(35).fill("0");
    f[0] = "1"; f[1] = "贵州茅台"; f[3] = "1297.50"; f[4] = "1299.56"; f[5] = "1302.80";
    f[33] = "1303.00"; f[34] = "1291.20";
    const q = parseTencentQuote(`v_sh600519="${f.join("~")}";`);
    expect(q?.high).toBe(1303);
    expect(q?.low).toBe(1291.2);
  });

  it("keeps high/low as NaN when the fields are absent, so the UI still shows 「—」", () => {
    // 短串（老测试用例的长度）：33/34 位根本不存在，不能变成 Number("") 的 0，
    // 否则个股页会把「最高」显示成 0.00，比空着更误导。
    const q = parseTencentQuote('v_sh688981="1~中芯国际~688981~88.00~80.00~86.00~x~x";');
    expect(q?.price).toBe(88);
    expect(Number.isNaN(q!.high)).toBe(true);
    expect(Number.isNaN(q!.low)).toBe(true);
  });
});

describe("parseEastmoneyTicks (指数概览条的主源)", () => {
  const wrap = (diff: unknown[]) => ({ rc: 0, data: { total: diff.length, diff } });

  it("keys rows by 市场前缀.代码 and takes fltt=2 的十进制价格", () => {
    const ticks = parseEastmoneyTicks(
      wrap([
        { f2: 3941.39, f3: -0.97, f12: "000001", f13: 1, f14: "上证指数" },
        { f2: 4370.2, f3: -0.6, f12: "GC00Y", f13: 101, f14: "COMEX黄金" },
      ]),
    );
    expect(ticks.size).toBe(2);
    expect(ticks.get("1.000001")?.price).toBe(3941.39);
    expect(ticks.get("1.000001")?.changePct).toBeCloseTo(-0.97, 5);
    expect(ticks.get("101.GC00Y")?.name).toBe("COMEX黄金");
  });

  it("drops 停牌/未开盘 的 \"-\" 与非正价格，而不是把它们渲染成 0.00", () => {
    const ticks = parseEastmoneyTicks(
      wrap([
        { f2: "-", f3: "-", f12: "HSTECH", f13: 124, f14: "恒生科技指数" },
        { f2: 0, f3: 0, f12: "000300", f13: 1, f14: "沪深300" },
        { f2: 26099.77, f3: -1.03, f12: "NDX", f13: 100, f14: "纳斯达克" },
      ]),
    );
    expect([...ticks.keys()]).toEqual(["100.NDX"]);
  });

  it("returns an empty map for a shaped-but-empty or malformed payload", () => {
    expect(parseEastmoneyTicks(wrap([])).size).toBe(0);
    expect(parseEastmoneyTicks({ rc: 0, data: null }).size).toBe(0);
    expect(parseEastmoneyTicks(null).size).toBe(0);
    expect(parseEastmoneyTicks("boom").size).toBe(0);
  });
});
