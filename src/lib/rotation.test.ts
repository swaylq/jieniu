import { describe, it, expect } from "vitest";
import {
  parseFlowRows,
  aggregateSectors,
  rankSectors,
  discoverStocks,
  MIN_MEMBERS,
  type StockFlow,
} from "./rotation";

const raw = {
  data: {
    total: 3,
    diff: [
      { f12: "600519", f14: "贵州茅台", f2: 1289.5, f3: 2.85, f62: 733880816, f184: 5.04 },
      { f12: "000858", f14: "五粮液", f2: 120.1, f3: 1.9, f62: 120000000, f184: 3.2 },
      { f12: "600036", f14: "招商银行", f2: 40.2, f3: -1.1, f62: -50000000, f184: -2.1 },
      { f12: "BAD", f14: "坏行", f2: "-", f3: "-", f62: "-" },
    ],
  },
};

describe("parseFlowRows", () => {
  it("解析代码/名称/价格/涨跌幅/主力净流入/净占比", () => {
    const rows = parseFlowRows(raw);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      code: "600519",
      name: "贵州茅台",
      price: 1289.5,
      changePct: 2.85,
      netInflow: 733880816,
      inflowRatio: 5.04,
    });
  });

  it("停牌/无数据的行（字段是 '-'）直接丢掉，不当成 0", () => {
    expect(parseFlowRows(raw).some((r) => r.code === "BAD")).toBe(false);
  });

  it("结构不对返回空数组，不抛", () => {
    expect(parseFlowRows(null)).toEqual([]);
    expect(parseFlowRows({ data: {} })).toEqual([]);
  });
});

// ── 聚合 ───────────────────────────────────────────────────────────
const flows: StockFlow[] = [
  { code: "a1", name: "甲1", price: 10, changePct: 5, netInflow: 500, inflowRatio: 6 },
  { code: "a2", name: "甲2", price: 20, changePct: 3, netInflow: 300, inflowRatio: 4 },
  { code: "a3", name: "甲3", price: 30, changePct: 1, netInflow: 100, inflowRatio: 2 },
  { code: "a4", name: "甲4", price: 40, changePct: 4, netInflow: 200, inflowRatio: 3 },
  { code: "a5", name: "甲5", price: 50, changePct: 2, netInflow: -50, inflowRatio: -1 },
  { code: "b1", name: "乙1", price: 10, changePct: -6, netInflow: -600, inflowRatio: -7 },
  { code: "b2", name: "乙2", price: 20, changePct: -4, netInflow: -400, inflowRatio: -5 },
  { code: "b3", name: "乙3", price: 30, changePct: -2, netInflow: -200, inflowRatio: -3 },
  { code: "b4", name: "乙4", price: 40, changePct: -3, netInflow: -100, inflowRatio: -2 },
  { code: "b5", name: "乙5", price: 50, changePct: 1, netInflow: 50, inflowRatio: 1 },
  { code: "c1", name: "丙1", price: 10, changePct: 0.5, netInflow: 10, inflowRatio: 0.5 },
];
const membership = new Map<string, string>([
  ...["a1", "a2", "a3", "a4", "a5"].map((c) => [c, "甲板块"] as [string, string]),
  ...["b1", "b2", "b3", "b4", "b5"].map((c) => [c, "乙板块"] as [string, string]),
  ["c1", "丙板块"],
]);

describe("aggregateSectors", () => {
  const aggs = aggregateSectors(flows, membership);
  const jia = aggs.find((a) => a.sector === "甲板块")!;
  const yi = aggs.find((a) => a.sector === "乙板块")!;

  it("算出均涨跌、涨跌家数、主力净流入合计", () => {
    expect(jia.avgChangePct).toBe(3); // (5+3+1+4+2)/5
    expect(jia.up).toBe(5);
    expect(jia.down).toBe(0);
    expect(jia.netInflow).toBe(1050);
  });

  it("上涨板块的代表股 = 主力买得最多的三只", () => {
    expect(jia.leaders.map((s) => s.code)).toEqual(["a1", "a2", "a4"]);
  });

  it("下跌板块的代表股 = 主力卖得最多的三只——按板块自身方向取，才叫「代表」", () => {
    // 若一律按净流入降序，共跌板块选出来的是「最抗跌的」，跟「代表这个板块在跌」正好相反。
    expect(yi.leaders.map((s) => s.code)).toEqual(["b1", "b2", "b3"]);
  });

  it("成分股太少的板块直接排除——3 只股的均值没有代表性", () => {
    expect(aggs.some((a) => a.sector === "丙板块")).toBe(false);
    expect(MIN_MEMBERS).toBeGreaterThan(1);
  });

  it("不在任何板块里的个股被忽略，不产生「未分类」桶", () => {
    const withOrphan = aggregateSectors(
      [...flows, { code: "zz", name: "孤儿", price: 1, changePct: 9, netInflow: 9, inflowRatio: 9 }],
      membership,
    );
    expect(withOrphan.some((a) => a.sector.includes("未分类"))).toBe(false);
  });

  it("一致度取涨跌两侧的多数占比——共振与共跌都算「步调一致」", () => {
    expect(jia.alignment).toBe(1); // 5 涨 0 跌
    expect(yi.alignment).toBeCloseTo(0.8, 5); // 4 跌 1 涨
  });
});

describe("rankSectors", () => {
  const ranked = rankSectors(aggregateSectors(flows, membership), 5);

  it("强跌板块同样入选——轮动看的是「动得厉害」，不是只看涨", () => {
    expect(ranked.map((r) => r.sector).sort()).toEqual(["乙板块", "甲板块"]);
  });

  it("给出共振 / 共跌 / 分化 三档信号", () => {
    expect(ranked.find((r) => r.sector === "甲板块")!.signal).toBe("共振");
    expect(ranked.find((r) => r.sector === "乙板块")!.signal).toBe("共跌");
  });

  it("步调不一致时是「分化」，不硬给方向", () => {
    const mixed = aggregateSectors(
      [
        { code: "m1", name: "m1", price: 1, changePct: 9, netInflow: 1, inflowRatio: 1 },
        { code: "m2", name: "m2", price: 1, changePct: -8, netInflow: 1, inflowRatio: 1 },
        { code: "m3", name: "m3", price: 1, changePct: 7, netInflow: 1, inflowRatio: 1 },
        { code: "m4", name: "m4", price: 1, changePct: -6, netInflow: 1, inflowRatio: 1 },
        { code: "m5", name: "m5", price: 1, changePct: 5, netInflow: 1, inflowRatio: 1 },
      ],
      new Map(["m1", "m2", "m3", "m4", "m5"].map((c) => [c, "混板块"])),
    );
    expect(rankSectors(mixed, 5)[0]!.signal).toBe("分化");
  });

  it("limit 截断", () => {
    expect(rankSectors(aggregateSectors(flows, membership), 1)).toHaveLength(1);
  });
});

describe("discoverStocks", () => {
  const ranked = rankSectors(aggregateSectors(flows, membership), 5);
  const found = discoverStocks(flows, membership, ranked, 3);

  it("只从入选板块里挑股——「个股发现」要能说出它属于哪条在动的线", () => {
    expect(found.every((s) => ["甲板块", "乙板块"].includes(s.sector))).toBe(true);
  });

  it("每只都带可核对的发现理由：涨跌 + 资金流 + 所属板块", () => {
    const top = found[0]!;
    expect(top.reason).toContain("%");
    expect(top.reason).toContain(top.sector);
    expect(typeof top.netInflow).toBe("number");
  });

  it("按「涨幅 × 资金流入」挑，资金流出的不进发现位", () => {
    expect(found.every((s) => s.netInflow > 0)).toBe(true);
    expect(found[0]!.code).toBe("a1");
  });

  it("同一板块最多占两席——否则一个强势板块会把发现位霸屏（早报霸屏同类问题）", () => {
    // 甲板块 4 只都是净流入且涨幅靠前，不设上限会把 5 个位置占掉 4 个。
    const many = discoverStocks(flows, membership, ranked, 5);
    const perSector = new Map<string, number>();
    for (const d of many) perSector.set(d.sector, (perSector.get(d.sector) ?? 0) + 1);
    expect(Math.max(...perSector.values())).toBeLessThanOrEqual(2);
  });

  it("名额没被占满时，宁可少给也不破上限——不为凑数塞同板块第三只", () => {
    const only = discoverStocks(flows, membership, ranked, 10);
    const perSector = new Map<string, number>();
    for (const d of only) perSector.set(d.sector, (perSector.get(d.sector) ?? 0) + 1);
    expect(Math.max(...perSector.values())).toBeLessThanOrEqual(2);
  });

  it("limit 截断，且不重复", () => {
    const two = discoverStocks(flows, membership, ranked, 2);
    expect(two).toHaveLength(2);
    expect(new Set(two.map((s) => s.code)).size).toBe(2);
  });
});
