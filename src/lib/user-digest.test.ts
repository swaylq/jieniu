import { describe, it, expect } from "vitest";
import {
  summarizePortfolio,
  summarizeExposure,
  buildUserDigestPrompt,
  parseUserDigestResponse,
  userDigestInputHash,
  type PositionIn,
  type FlowIn,
  type UserDigestFacts,
} from "./user-digest";

const pos = (o: Partial<PositionIn> & { name: string }): PositionIn => ({
  entityId: `e-${o.name}`,
  ticker: null,
  held: false,
  weight: null,
  note: null,
  sector: null,
  ...o,
});

const flow = (code: string, changePct: number): FlowIn => ({
  code,
  name: code,
  changePct,
  netInflow: 0,
});

describe("summarizePortfolio — 数字全由代码算", () => {
  it("统计涨跌家数与简单均值（无仓位时）", () => {
    const p = summarizePortfolio(
      [
        pos({ name: "A", ticker: "1" }),
        pos({ name: "B", ticker: "2" }),
        pos({ name: "C", ticker: "3" }),
      ],
      [flow("1", 3), flow("2", -1), flow("3", 0)],
    );
    expect(p.total).toBe(3);
    expect(p.up).toBe(1);
    expect(p.down).toBe(1);
    expect(p.flat).toBe(1);
    expect(p.weighted).toBe(false);
    expect(p.avgChangePct).toBeCloseTo(0.67, 1);
  });

  it("有仓位时按仓位加权，并标记 weighted=true", () => {
    const p = summarizePortfolio(
      [
        pos({ name: "A", ticker: "1", weight: 80 }),
        pos({ name: "B", ticker: "2", weight: 20 }),
      ],
      [flow("1", 10), flow("2", -10)],
    );
    expect(p.weighted).toBe(true);
    expect(p.avgChangePct).toBeCloseTo(6, 5); // 0.8*10 + 0.2*(-10)
  });

  it("只有部分股有仓位时不装作加权——口径要么全有要么不用", () => {
    const p = summarizePortfolio(
      [pos({ name: "A", ticker: "1", weight: 50 }), pos({ name: "B", ticker: "2" })],
      [flow("1", 10), flow("2", -10)],
    );
    expect(p.weighted).toBe(false);
    expect(p.avgChangePct).toBeCloseTo(0, 5);
  });

  it("取不到行情的持仓不计入均值，也不当 0", () => {
    const p = summarizePortfolio(
      [pos({ name: "A", ticker: "1" }), pos({ name: "无行情", ticker: "9" })],
      [flow("1", 4)],
    );
    expect(p.total).toBe(2);
    expect(p.quoted).toBe(1);
    expect(p.avgChangePct).toBeCloseTo(4, 5);
  });

  it("movers 按绝对涨跌排序，持仓优先于观察", () => {
    const p = summarizePortfolio(
      [
        pos({ name: "观察大涨", ticker: "1" }),
        pos({ name: "持仓小跌", ticker: "2", held: true }),
      ],
      [flow("1", 9), flow("2", -1)],
    );
    expect(p.movers[0]!.name).toBe("持仓小跌");
    expect(p.movers[0]!.held).toBe(true);
  });

  it("没有任何行情时给出空态而不是伪造的 0%", () => {
    const p = summarizePortfolio([pos({ name: "A", ticker: "1" })], []);
    expect(p.quoted).toBe(0);
    expect(p.avgChangePct).toBeNull();
  });
});

describe("summarizeExposure — 你的板块暴露 vs 今日强弱", () => {
  const sectors = [
    { name: "半导体", avgChangePct: -6.03, signal: "共跌" },
    { name: "白酒", avgChangePct: 2.94, signal: "共振" },
    { name: "银行", avgChangePct: 1.03, signal: "共振" },
  ];

  it("只报你真正持有/关注的板块", () => {
    const e = summarizeExposure(
      [
        pos({ name: "兆易创新", ticker: "1", sector: "半导体" }),
        pos({ name: "北方华创", ticker: "2", sector: "半导体" }),
        pos({ name: "招商银行", ticker: "3", sector: "银行" }),
      ],
      sectors,
    );
    expect(e.map((x) => x.sector)).toEqual(["半导体", "银行"]);
    expect(e[0]!.stocks).toEqual(["兆易创新", "北方华创"]);
    expect(e[0]!.sectorChangePct).toBeCloseTo(-6.03, 2);
  });

  it("按你暴露的股票数排序——占比大的先说", () => {
    const e = summarizeExposure(
      [
        pos({ name: "招商银行", ticker: "1", sector: "银行" }),
        pos({ name: "兆易创新", ticker: "2", sector: "半导体" }),
        pos({ name: "北方华创", ticker: "3", sector: "半导体" }),
      ],
      sectors,
    );
    expect(e[0]!.sector).toBe("半导体");
  });

  it("没有板块归属的股不制造空板块", () => {
    expect(summarizeExposure([pos({ name: "X", ticker: "1" })], sectors)).toEqual([]);
  });
});

const facts: UserDigestFacts = {
  tradeDate: "2026-07-28",
  market: "CN",
  profile: { style: "value", horizon: "long" },
  portfolio: {
    total: 2,
    held: 1,
    quoted: 2,
    up: 0,
    down: 2,
    flat: 0,
    avgChangePct: -8.5,
    weighted: false,
    movers: [
      { name: "兆易创新", ticker: "603986", changePct: -10, held: true, weight: 30, note: "存储周期拐点", facts: ["兆易创新:半年度业绩预告"] },
      { name: "东山精密", ticker: "002384", changePct: -7, held: false, weight: null, note: null, facts: [] },
    ],
  },
  exposure: [
    { sector: "半导体", stocks: ["兆易创新"], sectorChangePct: -6.03, signal: "共跌" },
  ],
  touched: [
    { entityName: "澜起科技", dimensionKey: "现金流与资本开支", fromState: "neutral", toState: "bullish", note: "回购进展" },
  ],
  news: [{ entityName: "兆易创新", title: "兆易创新:半年度业绩预告", brief: "净利预增" }],
  marketOverview: "A股主要指数普跌，半导体领跌。",
  catalysts: ["半年报法定披露截止还有 34 天"],
};

describe("buildUserDigestPrompt", () => {
  const p = buildUserDigestPrompt(facts);
  it("把用户自己的数据都喂进去", () => {
    expect(p).toContain("兆易创新");
    expect(p).toContain("持仓");
    expect(p).toContain("存储周期拐点"); // 用户自己写的持仓理由
    expect(p).toContain("半导体");
    expect(p).toContain("澜起科技");
    expect(p).toContain("A股主要指数普跌");
  });
  it("明确禁止模型输出数字", () => {
    expect(p).toContain("不要输出任何数字");
  });
});

describe("parseUserDigestResponse — 模型给的数字一律丢弃", () => {
  const good = JSON.stringify({
    headline: "你的组合今天普跌，半导体是主要拖累。",
    movers: [
      { name: "兆易创新", changePct: 999, note: "板块共跌，业绩预告未能对冲" },
      { name: "东山精密", note: "元件板块整体承压" },
    ],
    exposure: [{ sector: "半导体", note: "你在这个板块的暴露正对上今日最弱的一块" }],
    watchpoints: ["兆易创新半年报披露节奏", "半导体板块能否止跌"],
    judgment: "你的组合偏科技制造，与今日最弱板块高度重合；若半导体企稳，回补弹性也会更大。反之，若跌势延续，集中度会放大波动。",
  });

  it("解析成功且**数字来自 facts 而非模型**", () => {
    const d = parseUserDigestResponse(good, facts);
    expect(d).not.toBeNull();
    const m = d!.portfolio.movers.find((x) => x.name === "兆易创新")!;
    expect(m.changePct).toBe(-10); // 不是模型说的 999
    expect(m.note).toContain("业绩预告");
    expect(d!.portfolio.avgChangePct).toBe(-8.5);
  });

  it("模型编出来的、不在组合里的股票被丢弃", () => {
    const fake = JSON.stringify({
      ...JSON.parse(good),
      movers: [
        { name: "贵州茅台", note: "编的：茅台发布半年度业绩预告" },
        { name: "兆易创新", note: "半年度业绩预告净利预增" },
      ],
    });
    const d = parseUserDigestResponse(fake, facts);
    expect(d!.portfolio.movers.map((m) => m.name)).toEqual(["兆易创新", "东山精密"]);
    expect(d!.portfolio.movers.find((m) => m.name === "兆易创新")!.note).toBe(
      "半年度业绩预告净利预增",
    );
  });

  it("该标的当天没有事实 → note 一律作废（那必然是编的或板块废话）", () => {
    const made = JSON.stringify({
      ...JSON.parse(good),
      // 东山精密的 facts 是空的，模型却给了一句像模像样的归因
      movers: [{ name: "东山精密", note: "PCB 订单超预期带动估值修复" }],
    });
    const d = parseUserDigestResponse(made, facts);
    expect(d!.portfolio.movers.find((m) => m.name === "东山精密")!.note).toBe("");
  });

  it("有事实的标的，归因不必命中锚点词表也留得下（词表一定有洞）", () => {
    const ok = JSON.stringify({
      ...JSON.parse(good),
      movers: [{ name: "兆易创新", note: "纳入指数预期推动资金抢筹" }],
    });
    const d = parseUserDigestResponse(ok, facts);
    expect(d!.portfolio.movers.find((m) => m.name === "兆易创新")!.note).toBe(
      "纳入指数预期推动资金抢筹",
    );
  });

  it("循环归因的 note 一律置空——这条正是「所有都是受板块影响走跌」的对治", () => {
    const waffle = JSON.stringify({
      ...JSON.parse(good),
      movers: [{ name: "兆易创新", note: "受半导体板块整体走弱压制" }],
      exposure: [{ sector: "半导体", note: "板块走弱，可能影响你的持仓表现" }],
      watchpoints: ["关注半导体板块能否企稳", "兆易创新半年报披露时点"],
    });
    const d = parseUserDigestResponse(waffle, facts);
    expect(d!.portfolio.movers.find((m) => m.name === "兆易创新")!.note).toBe("");
    expect(d!.exposure[0]!.note).toBe("");
    // 关注点只拦循环归因，不强求锚点（明天要验证的事未必有今天的数字）
    expect(d!.watchpoints).toEqual(["兆易创新半年报披露时点"]);
  });

  it("模型没给 note 时不拿用户自己写的持仓理由顶包（那是长期逻辑，不是当日归因）", () => {
    const none = JSON.stringify({ ...JSON.parse(good), movers: [] });
    const d = parseUserDigestResponse(none, facts);
    expect(d!.portfolio.movers.find((m) => m.name === "兆易创新")!.note).toBe("");
  });

  it("持仓的自有事实要进提示词，没有事实的要显式告诉模型留空", () => {
    const prompt = buildUserDigestPrompt(facts);
    expect(prompt).toContain("今日相关：兆易创新:半年度业绩预告");
    expect(prompt).toContain("（无）→ 这只的 note 必须留空");
  });

  it("板块同理：不在你暴露里的板块丢掉，数字用算出来的", () => {
    const d = parseUserDigestResponse(good, facts);
    expect(d!.exposure).toHaveLength(1);
    expect(d!.exposure[0]!.sectorChangePct).toBeCloseTo(-6.03, 2);
  });

  it("触及逻辑那段完全不经模型——直接用事实", () => {
    const d = parseUserDigestResponse(good, facts);
    expect(d!.touched[0]!.entityName).toBe("澜起科技");
    expect(d!.touched[0]!.toState).toBe("bullish");
  });

  it("缺 headline / judgment，或判断含买卖指令、非双向 → null", () => {
    const noHead = JSON.stringify({ ...JSON.parse(good), headline: "" });
    expect(parseUserDigestResponse(noHead, facts)).toBeNull();
    const advice = JSON.stringify({ ...JSON.parse(good), judgment: "建议减仓半导体。" });
    expect(parseUserDigestResponse(advice, facts)).toBeNull();
    const oneSided = JSON.stringify({ ...JSON.parse(good), judgment: "你的组合会继续下跌。" });
    expect(parseUserDigestResponse(oneSided, facts)).toBeNull();
    expect(parseUserDigestResponse("不是 JSON", facts)).toBeNull();
  });
});

describe("userDigestInputHash", () => {
  it("同事实同指纹，事实变则变", () => {
    expect(userDigestInputHash(facts)).toBe(userDigestInputHash({ ...facts }));
    expect(
      userDigestInputHash({ ...facts, marketOverview: "别的" }),
    ).not.toBe(userDigestInputHash(facts));
  });
});
