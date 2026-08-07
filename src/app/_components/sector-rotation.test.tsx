import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectorRotation, StockDiscovery } from "./sector-rotation";

const sectors = [
  {
    sector: "半导体",
    sectorId: "sec-1",
    members: 212,
    up: 180,
    down: 25,
    flat: 7,
    avgChangePct: 3.42,
    netInflow: 1_250_000_000,
    alignment: 0.849,
    signal: "共振" as const,
    leaders: [
      { code: "688981", name: "中芯国际", price: 98.5, changePct: 5.1, netInflow: 3.2e8, inflowRatio: 6, entityId: "lead-1" },
      { code: "002371", name: "北方华创", price: 410, changePct: 4.2, netInflow: 2.1e8, inflowRatio: 5, entityId: null },
    ],
  },
  {
    sector: "白酒Ⅱ",
    sectorId: "sec-2",
    members: 19,
    up: 2,
    down: 16,
    flat: 1,
    avgChangePct: -2.8,
    netInflow: -430_000_000,
    alignment: 0.842,
    signal: "共跌" as const,
    leaders: [
      { code: "600519", name: "贵州茅台", price: 1289, changePct: -1.2, netInflow: -1e8, inflowRatio: -2, entityId: "lead-2" },
    ],
  },
];
const discoveries = [
  {
    code: "688981", name: "中芯国际", price: 98.5, changePct: 5.1,
    netInflow: 3.2e8, inflowRatio: 6, sector: "半导体", sectorId: "sec-1", entityId: "stk-9",
    reason: "涨5.1% · 主力净流入+3.20亿 · 板块：半导体",
  },
];
const asOf = new Date("2026-07-28T06:00:00Z");

const rot = renderToStaticMarkup(<SectorRotation sectors={sectors} asOf={asOf} />);
const dis = renderToStaticMarkup(<StockDiscovery items={discoveries} asOf={asOf} />);

describe("SectorRotation", () => {
  it("列出板块、均涨跌、联动家数、主力净流入、代表股", () => {
    expect(rot).toContain("半导体");
    expect(rot).toContain("3.42");
    expect(rot).toContain("180");
    expect(rot).toContain("25");
    expect(rot).toContain("中芯国际");
  });

  it("共振 / 共跌 两种信号都要标出来——强跌也是轮动", () => {
    expect(rot).toContain("共振");
    expect(rot).toContain("共跌");
  });

  it("涨跌幅用真实价格色（这是股价，红绿在这里是对的）", () => {
    expect(rot).toMatch(/text-up|text-down/);
  });

  it("主力净流入用中性色——它是资金流向不是价格，红绿会读成买卖信号（铁律①）", () => {
    // 净流入/净流出各有一条，若用了价格色则说明把流向当涨跌染色了
    expect(rot).not.toMatch(/text-(up|down)[^"]*">\s*[+-]?[\d.]+亿/);
    expect(rot).toContain("亿");
  });

  it("注明主力资金是东财口径、非交易所披露", () => {
    expect(rot).toContain("东方财富");
    expect(rot).toContain("非投资建议");
  });

  it("标注数据时间——盘中/盘后口径不同，必须让人看出新旧", () => {
    expect(rot).toContain("07/28");
  });

  it("无数据时整块不渲染", () => {
    expect(renderToStaticMarkup(<SectorRotation sectors={[]} asOf={null} />)).toBe("");
  });
});

describe("StockDiscovery", () => {
  it("给出代码、名称、涨跌、价格与可核对的发现理由", () => {
    expect(dis).toContain("688981");
    expect(dis).toContain("中芯国际");
    expect(dis).toContain("98.5");
    expect(dis).toContain("主力净流入");
    // 板块名现在是链接，「板块：」与名字之间隔着 <a>，不能整串匹配
    expect(dis).toContain("板块：");
    expect(dis).toContain("半导体");
  });

  it("股票代码链到**个股页**，不能链到板块页", () => {
    // 只断言 href="/entity/ 会漏掉「链错对象」——两者前缀一样。
    expect(dis).toContain('href="/entity/stk-9"');
    expect(dis).not.toContain('href="/entity/sec-1"><span class="tabular');
  });

  it("板块名可点，链到板块页", () => {
    expect(dis).toContain('href="/entity/sec-1"');
  });

  it("带「不构成投资建议」", () => {
    expect(dis).toContain("不构成投资建议");
  });

  it("无数据时整块不渲染", () => {
    expect(renderToStaticMarkup(<StockDiscovery items={[]} asOf={null} />)).toBe("");
  });
});

// sway：「这里名称点击也会进入」——个股发现里只有代码是链接，名称是纯文本，点不动。
describe("个股发现 / 代表股：名称也要能点进去（sway 反馈）", () => {
  it("名称和代码在同一个链接里，点名字也进个股页", () => {
    // 名称必须落在指向该个股实体的 <a> 之内，而不是链接外的纯文本
    const anchors = [...dis.matchAll(/<a[^>]*href="\/entity\/stk-9"[^>]*>([\s\S]*?)<\/a>/g)].map(
      (m) => m[1]!,
    );
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.join("")).toContain("中芯国际");
    expect(anchors.join("")).toContain("688981");
  });

  it("名称里不再重复代码——代码已经单独显示在前面了", () => {
    const withParen = renderToStaticMarkup(
      <StockDiscovery
        items={[{ ...discoveries[0]!, name: "德明利(001309)", code: "001309" }]}
        asOf={asOf}
      />,
    );
    expect(withParen).toContain("德明利");
    expect(withParen).not.toContain("德明利(001309)");
  });

  it("拿不到实体 id 时优雅退化成纯文本，不产生死链", () => {
    const noId = renderToStaticMarkup(
      <StockDiscovery items={[{ ...discoveries[0]!, entityId: null }]} asOf={asOf} />,
    );
    expect(noId).toContain("中芯国际");
    expect(noId).not.toContain('href="/entity/null"');
  });

  it("板块轮动的「主力资金前三」也可点（有 id 才给链接）", () => {
    expect(rot).toMatch(/<a[^>]*href="\/entity\/lead-1"[^>]*>[\s\S]*?中芯国际/);
  });
});
