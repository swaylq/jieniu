import { describe, it, expect } from "vitest";
import {
  containsToken,
  matchEntities,
  resolveHints,
  stripBoilerplate,
  hasCoveredEntity,
  type EntityDictEntry,
} from "./entity-tagging";

const DICT: EntityDictEntry[] = [
  { id: "smic", type: "COMPANY", name: "中芯国际", shortName: "中芯国际", aliases: ["SMIC"], ticker: "688981" },
  { id: "sector", type: "SECTOR", name: "半导体", aliases: ["芯片", "IC"] },
  { id: "nmc", type: "COMPANY", name: "北方华创", aliases: [], ticker: "002371" },
];

describe("containsToken", () => {
  it("substring-matches CJK tokens", () => {
    expect(containsToken("今天中芯国际发布公告", "中芯国际")).toBe(true);
    expect(containsToken("一段无关文本", "中芯国际")).toBe(false);
  });
  it("word-boundary matches short ASCII / ticker to avoid false positives", () => {
    expect(containsToken("公司代码 688981 停牌", "688981")).toBe(true);
    expect(containsToken("编号2688981abc", "688981")).toBe(false);
    expect(containsToken("SMIC 扩产", "SMIC")).toBe(true);
    expect(containsToken("BASIC 教程", "IC")).toBe(false);
  });
});

describe("matchEntities", () => {
  it("returns ids of all entities mentioned, deduped", () => {
    const ids = matchEntities("中芯国际(688981)与北方华创同属半导体板块", DICT);
    expect([...ids].sort()).toEqual(["nmc", "sector", "smic"]);
  });
  it("matches nothing in unrelated text", () => {
    expect(matchEntities("今天天气不错", DICT)).toEqual([]);
  });
  it("dedupes when several tokens of one entity match", () => {
    expect(matchEntities("中芯国际 688981 大涨", DICT)).toEqual(["smic"]);
  });
});

describe("stripBoilerplate", () => {
  it("removes 公告 boilerplate that would pollute sector tagging", () => {
    expect(stripBoilerplate("证券代码：688008 证券简称：澜起科技")).not.toContain(
      "证券",
    );
    expect(stripBoilerplate("公司开户银行发生变更")).not.toContain("开户银行");
    expect(stripBoilerplate("上海证券交易所监管工作函")).not.toContain(
      "证券交易所",
    );
  });
});

describe("matchEntities 板块精度", () => {
  const D: EntityDictEntry[] = [
    {
      id: "broker",
      type: "SECTOR",
      name: "券商",
      shortName: "券商",
      aliases: ["证券公司", "证券板块"],
    },
    { id: "bank", type: "SECTOR", name: "银行", aliases: ["银行板块", "银行股"] },
  ];
  it("不把 证券代码/证券交易所/中泰证券股份 误配成券商板块", () => {
    expect(
      matchEntities("证券代码：600000 证券简称：X 上海证券交易所公告", D),
    ).toEqual([]);
    expect(
      matchEntities("中泰证券股份有限公司关于权益变动的公告", D),
    ).toEqual([]);
  });
  it("券商/证券板块 等主题词仍能命中券商板块", () => {
    expect(matchEntities("今日券商板块领涨", D)).toEqual(["broker"]);
    expect(matchEntities("证券板块午后拉升", D)).toEqual(["broker"]);
  });
  it("裸词'银行'不认（德银/美国银行/开户银行样板都不误配）", () => {
    expect(matchEntities("公司开户银行信息变更", D)).toEqual([]);
    expect(matchEntities("德银：Meta云业务打开AI变现通道", D)).toEqual([]);
    expect(matchEntities("美国银行上调欧洲电信行业评级", D)).toEqual([]);
  });
  it("银行板块/银行股 主题词仍能命中银行板块", () => {
    expect(matchEntities("银行板块走强", D)).toEqual(["bank"]);
    expect(matchEntities("银行股午后拉升", D)).toEqual(["bank"]);
  });
});

describe("resolveHints", () => {
  it("resolves company name / ticker hints to entity ids", () => {
    expect(resolveHints(["中芯国际", "688981"], DICT)).toContain("smic");
    expect(resolveHints(["北方华创"], DICT)).toEqual(["nmc"]);
  });
  it("returns empty for missing or unknown hints", () => {
    expect(resolveHints(undefined, DICT)).toEqual([]);
    expect(resolveHints(["不存在的公司"], DICT)).toEqual([]);
  });
});

describe("hasCoveredEntity", () => {
  const byId = new Map(DICT.map((d) => [d.id, d]));
  it("认 COMPANY / STOCK 绑定（覆盖标的）", () => {
    expect(hasCoveredEntity(["smic"], byId)).toBe(true); // COMPANY
  });
  it("仅 SECTOR 绑定视为未覆盖（公告是公司专属体裁，板块名误绑不算）", () => {
    expect(hasCoveredEntity(["sector"], byId)).toBe(false);
  });
  it("纯未绑定 = 未覆盖", () => {
    expect(hasCoveredEntity([], byId)).toBe(false);
  });
  it("COMPANY + SECTOR 混合仍算覆盖", () => {
    expect(hasCoveredEntity(["sector", "smic"], byId)).toBe(true);
  });
  it("未知 id 忽略", () => {
    expect(hasCoveredEntity(["不存在"], byId)).toBe(false);
  });
});

describe("机构名裹住公司名的误配（2026-07-23 质量审计）", () => {
  const dict = [
    {
      id: "boc",
      type: "COMPANY" as const,
      name: "中国银行",
      shortName: null,
      aliases: [],
      ticker: "601988",
    },
  ];

  it("别家公司「收到中国银行间市场交易商协会通知书」不绑到中国银行", () => {
    expect(
      matchEntities(
        "甘肃能源:关于收到中国银行间市场交易商协会《接受注册通知书》的公告",
        dict,
      ),
    ).toEqual([]);
  });

  it("中国银行自己的公告照常绑上", () => {
    expect(
      matchEntities("中国银行股份有限公司2026年半年度业绩快报", dict),
    ).toEqual(["boc"]);
  });

  it("代码仍可命中", () => {
    expect(matchEntities("601988 回购进展", dict)).toEqual(["boc"]);
  });
});
