import { describe, expect, it } from "vitest";

import {
  aggregateBlockTrades,
  aggregateHsgtSeats,
  aggregateOrgRows,
  hsgtSeat,
  isInstitutionSeat,
  normalizeSeat,
  traceText,
  type BlockRow,
  type OrgRow,
  type SeatRow,
} from "./institutional-trace";

describe("席位名判定 —— 精确匹配，不能用包含", () => {
  it("认「机构专用」", () => {
    expect(isInstitutionSeat("机构专用")).toBe(true);
  });

  it("不认「申万宏源证券有限公司机构客户总部」", () => {
    // 2026-08-27 当天真实存在的一条。用「包含『机构』」去筛会把它错当机构席位。
    expect(isInstitutionSeat("申万宏源证券有限公司机构客户总部")).toBe(false);
  });

  it("挡住「投资者分类交易统计」那张表的类别名", () => {
    // 严重异常波动股附的那张表，席位名其实是投资者类别，金额是区间累计、量级差百倍。
    for (const n of ["机构", "自然人", "其中:中小投资者", "其他自然人", "深股通", "沪股通"]) {
      expect(isInstitutionSeat(n)).toBe(false);
    }
    // 类别名「深股通」不能被当成席位名「深股通专用」
    expect(hsgtSeat("深股通")).toBeNull();
    expect(hsgtSeat("沪股通")).toBeNull();
  });

  it("认北向席位的两个精确名", () => {
    expect(hsgtSeat("沪股通专用")).toBe("沪股通专用");
    expect(hsgtSeat("深股通专用")).toBe("深股通专用");
  });

  it("清掉全角空格与 &nbsp; 再比", () => {
    expect(normalizeSeat("机构　专用")).toBe("机构专用");
    expect(isInstitutionSeat("机构&nbsp;专用")).toBe(true);
    expect(isInstitutionSeat("  机构专用  ")).toBe(true);
  });

  it("空值不误判", () => {
    expect(isInstitutionSeat(null)).toBe(false);
    expect(isInstitutionSeat("")).toBe(false);
    expect(hsgtSeat(undefined)).toBeNull();
  });
});

function org(code: string, o: Partial<OrgRow> = {}): OrgRow {
  return {
    SECURITY_CODE: code,
    TRADE_DATE: "2026-08-27 00:00:00",
    BUY_TIMES: 1,
    SELL_TIMES: 0,
    BUY_AMT: 1e7,
    SELL_AMT: 0,
    NET_BUY_AMT: 1e7,
    ...o,
  };
}

describe("aggregateOrgRows —— 同股同日多条上榜理由不能求和", () => {
  it("多行取席位数最多的那一行，不累加", () => {
    // 002412 汉森制药 2026-08-27 真实形态：两条上榜理由，席位互相重叠。
    const rows = [
      org("002412", { BUY_TIMES: 4, SELL_TIMES: 2, NET_BUY_AMT: 7.5e7 }),
      org("002412", { BUY_TIMES: 3, SELL_TIMES: 2, NET_BUY_AMT: 7.2e7 }),
    ];
    const out = aggregateOrgRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.netAmount).toBe(7.5e7); // 不是 1.47e8
    expect(out[0]!.detail.buySeats).toBe(4);
  });

  it("席位数并列时取净额绝对值大的", () => {
    const rows = [
      org("600000", { BUY_TIMES: 2, SELL_TIMES: 1, NET_BUY_AMT: 1e6 }),
      org("600000", { BUY_TIMES: 1, SELL_TIMES: 2, NET_BUY_AMT: -5e6 }),
    ];
    expect(aggregateOrgRows(rows)[0]!.netAmount).toBe(-5e6);
  });

  it("不同交易日各自成行", () => {
    const rows = [
      org("600000", { TRADE_DATE: "2026-08-27 00:00:00" }),
      org("600000", { TRADE_DATE: "2026-08-26 00:00:00" }),
    ];
    expect(aggregateOrgRows(rows)).toHaveLength(2);
  });

  it("缺代码或日期的行直接丢掉，不写脏数据", () => {
    expect(aggregateOrgRows([org("", {}), org("600000", { TRADE_DATE: "" })])).toHaveLength(0);
  });
});

function seat(code: string, name: string, buy: number, sell: number): SeatRow {
  return {
    SECURITY_CODE: code,
    TRADE_DATE: "2026-08-27 00:00:00",
    OPERATEDEPT_NAME: name,
    BUY: buy,
    SELL: sell,
  };
}

describe("aggregateHsgtSeats", () => {
  it("北向席位按股按日求和，并记下是沪还是深", () => {
    const out = aggregateHsgtSeats([
      seat("600000", "沪股通专用", 3e7, 1e7),
      seat("600000", "沪股通专用", 1e7, 0),
      seat("000001", "深股通专用", 5e6, 8e6),
    ]);
    const sh = out.find((t) => t.ticker === "600000")!;
    expect(sh.buyAmount).toBe(4e7);
    expect(sh.netAmount).toBe(3e7);
    expect(sh.detail.seats).toEqual(["沪股通专用"]);
    expect(out.find((t) => t.ticker === "000001")!.netAmount).toBe(-3e6);
  });

  it("普通营业部和投资者类别行都不进来", () => {
    const out = aggregateHsgtSeats([
      seat("600000", "中信证券股份有限公司北京分公司", 1e8, 0),
      seat("600000", "深股通", 9e9, 0), // 分类统计行，金额量级百倍
      seat("600000", "机构专用", 1e8, 0),
    ]);
    expect(out).toHaveLength(0);
  });
});

function blk(o: Partial<BlockRow> = {}): BlockRow {
  return {
    SECURITY_CODE: "000923",
    TRADE_DATE: "2026-08-26 00:00:00",
    DEAL_PRICE: 16.2,
    CLOSE_PRICE: 17.6,
    PREMIUM_RATIO: -8,
    DEAL_AMT: 1e7,
    BUYER_NAME: "机构专用",
    SELLER_NAME: "中信证券股份有限公司宁波天童北路证券营业部",
    ...o,
  };
}

describe("aggregateBlockTrades —— 拆单必须先合并", () => {
  it("同日同股同价同买卖方视为同一笔，不重复计数", () => {
    // 河钢资源 2026-08-26 真实形态：同价 16.20 拆 4 笔。
    const rows = [blk(), blk(), blk(), blk()];
    const out = aggregateBlockTrades(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.detail.deals).toBe(1);
    expect(out[0]!.buyAmount).toBe(1e7);
  });

  it("同价但卖方不同 = 不同笔，各自计入", () => {
    const out = aggregateBlockTrades([
      blk({ SELLER_NAME: "A 营业部" }),
      blk({ SELLER_NAME: "B 营业部" }),
    ]);
    expect(out[0]!.detail.deals).toBe(2);
    expect(out[0]!.buyAmount).toBe(2e7);
  });

  it("机构是卖方时净额为负", () => {
    const out = aggregateBlockTrades([
      blk({ BUYER_NAME: "某营业部", SELLER_NAME: "机构专用" }),
    ]);
    expect(out[0]!.netAmount).toBe(-1e7);
  });

  it("买卖双方都是机构专用时净额为 0，但仍记一条", () => {
    const out = aggregateBlockTrades([
      blk({ BUYER_NAME: "机构专用", SELLER_NAME: "机构专用" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.netAmount).toBe(0);
    expect(out[0]!.buyAmount).toBe(1e7);
  });

  it("两边都不是机构专用的笔直接跳过", () => {
    expect(
      aggregateBlockTrades([blk({ BUYER_NAME: "A", SELLER_NAME: "B" })]),
    ).toHaveLength(0);
  });

  it("折溢价按成交额加权，不是等权平均", () => {
    // 1 亿折价 8% + 100 万溢价 1%：等权会得 −3.5%，加权应接近 −8%。
    const out = aggregateBlockTrades([
      blk({ DEAL_AMT: 1e8, PREMIUM_RATIO: -8, DEAL_PRICE: 10 }),
      blk({ DEAL_AMT: 1e6, PREMIUM_RATIO: 1, DEAL_PRICE: 11 }),
    ]);
    expect(out[0]!.detail.premiumRatio as number).toBeCloseTo(-7.91, 1);
  });
});

describe("traceText —— 只陈述披露了什么", () => {
  it("机构席位写出买卖席位数，不猜是哪类机构", () => {
    const t = aggregateOrgRows([
      org("001309", { BUY_TIMES: 3, SELL_TIMES: 1, NET_BUY_AMT: 5.99e8 }),
    ])[0]!;
    const s = traceText(t);
    expect(s).toContain("机构专用席位净买入 5.99 亿");
    expect(s).toContain("3 个席位买入、1 个席位卖出");
    // 匿名是交易所规则决定的，任何「公募/险资/QFII」的说法都是编。
    for (const w of ["公募", "险资", "保险", "社保", "QFII", "私募"]) {
      expect(s).not.toContain(w);
    }
  });

  it("金额不足 1 亿用万作单位", () => {
    const t = aggregateOrgRows([org("600000", { NET_BUY_AMT: 8.3e7 })])[0]!;
    expect(traceText(t)).toContain("8300 万");
  });

  it("大宗写清折价还是溢价", () => {
    const t = aggregateBlockTrades([blk({ DEAL_AMT: 4.2e7, PREMIUM_RATIO: -1.8 })])[0]!;
    expect(traceText(t)).toContain("折价 1.8%");
  });
});
