import { describe, it, expect } from "vitest";
import {
  withinOneEdit,
  fuzzyMatchEntities,
  distinctCompanies,
} from "./entity-fuzzy";
import type { EntityDictEntry } from "./entity-tagging";

const dict: EntityDictEntry[] = [
  { id: "qi-co", type: "COMPANY", name: "麒盛科技", shortName: null, aliases: [], ticker: null },
  { id: "qi-st", type: "STOCK", name: "麒盛科技(603610)", shortName: "麒盛科技", aliases: [], ticker: "603610" },
  { id: "cx", type: "COMPANY", name: "长鑫科技", shortName: null, aliases: ["长鑫存储"], ticker: null },
  { id: "md", type: "COMPANY", name: "美的集团", shortName: null, aliases: [], ticker: null },
  { id: "mg", type: "COMPANY", name: "美光", shortName: null, aliases: [], ticker: null },
  { id: "sec", type: "SECTOR", name: "半导体", shortName: null, aliases: [], ticker: null },
];

describe("withinOneEdit", () => {
  it("一个字写错（等长替换）", () => {
    expect(withinOneEdit("麟盛科技", "麒盛科技")).toBe(true);
  });
  it("少一个字 / 多一个字", () => {
    expect(withinOneEdit("麒盛科", "麒盛科技")).toBe(true);
    expect(withinOneEdit("麒盛科技技", "麒盛科技")).toBe(true);
  });
  it("完全相同不算——那是精确匹配的活", () => {
    expect(withinOneEdit("麒盛科技", "麒盛科技")).toBe(false);
  });
  it("差两个字以上不算", () => {
    expect(withinOneEdit("麟盛集团", "麒盛科技")).toBe(false);
    expect(withinOneEdit("长鑫科技", "麒盛科技")).toBe(false);
  });
});

describe("fuzzyMatchEntities", () => {
  it("【真实现场】张楚寒打的「麟盛科技半年报表现梳理」认出麒盛科技", () => {
    const hits = fuzzyMatchEntities("麟盛科技半年报表现梳理", dict);
    expect(distinctCompanies(hits)).toEqual(["麒盛科技"]);
    expect(hits[0]!.typed).toBe("麟盛科技");
  });

  it("名字打对时不归它管（调用方只在精确匹配为空时才调）", () => {
    // 「麒盛科技」与词典完全一致 → 编辑距离 0 → 不产出
    expect(fuzzyMatchEntities("麒盛科技半年报", dict)).toEqual([]);
  });

  it("两字名不做模糊——美的 / 美光 差一个字却是两家真公司", () => {
    expect(fuzzyMatchEntities("美光今年怎么样", dict)).toEqual([]);
    expect(fuzzyMatchEntities("美地今年怎么样", dict)).toEqual([]);
  });

  it("别名也能容错", () => {
    expect(distinctCompanies(fuzzyMatchEntities("长鑫存诸的产能", dict))).toEqual([
      "长鑫存储",
    ]);
  });

  it("板块名不参与——只认公司/股票", () => {
    expect(fuzzyMatchEntities("半异体行业怎么样", dict)).toEqual([]);
  });

  it("完全不相干的问题不误报", () => {
    expect(fuzzyMatchEntities("今天大盘怎么样", dict)).toEqual([]);
    expect(fuzzyMatchEntities("帮我梳理一下半年报的看点", dict)).toEqual([]);
  });

  it("英文与代码不做模糊——代码错一位就是另一只股", () => {
    expect(fuzzyMatchEntities("603611 最近有什么事", dict)).toEqual([]);
  });
});

describe("配额按公司名算，不按实体条数", () => {
  // 实测「麟盛科技」跟凯盛/隆盛/麒盛都只差一个字，而凯盛科技有 COMPANY+STOCK 两个实体。
  // 按实体条数截断会把真正要找的那家挤掉——用户看到的候选里根本没有他要的。
  const many: EntityDictEntry[] = [
    { id: "kai-co", type: "COMPANY", name: "凯盛科技", shortName: null, aliases: [], ticker: null },
    { id: "kai-st", type: "STOCK", name: "凯盛科技(600552)", shortName: "凯盛科技", aliases: [], ticker: "600552" },
    { id: "long-co", type: "COMPANY", name: "隆盛科技", shortName: null, aliases: [], ticker: null },
    { id: "long-st", type: "STOCK", name: "隆盛科技(300680)", shortName: "隆盛科技", aliases: [], ticker: "300680" },
    { id: "qi-co", type: "COMPANY", name: "麒盛科技", shortName: null, aliases: [], ticker: null },
    { id: "qi-st", type: "STOCK", name: "麒盛科技(603610)", shortName: "麒盛科技", aliases: [], ticker: "603610" },
  ];
  it("三家都要出现在候选里，一个都不能被孪生实体挤掉", () => {
    const names = distinctCompanies(fuzzyMatchEntities("麟盛科技半年报表现梳理", many));
    expect(names).toContain("麒盛科技");
    expect(names).toContain("凯盛科技");
    expect(names).toContain("隆盛科技");
  });
});
