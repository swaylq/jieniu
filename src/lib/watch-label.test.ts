import { describe, it, expect } from "vitest";
import { splitNameCode, watchEntityLabel } from "./watch-label";

describe("splitNameCode — 代码是烙在 STOCK 名字里的，展示前要拆出来", () => {
  it("拆掉尾部的 6 位代码", () => {
    expect(splitNameCode("东山精密(002384)")).toEqual({
      name: "东山精密",
      code: "002384",
    });
  });
  it("保留 -U / -UW 这类上市状态后缀（它是名字的一部分）", () => {
    expect(splitNameCode("摩尔线程-U(688795)")).toEqual({
      name: "摩尔线程-U",
      code: "688795",
    });
    expect(splitNameCode("大普微-UW(301666)")).toEqual({
      name: "大普微-UW",
      code: "301666",
    });
  });
  it("没有代码就原样返回", () => {
    expect(splitNameCode("国盾量子")).toEqual({ name: "国盾量子", code: null });
  });
  it("不误伤非代码的括号", () => {
    expect(splitNameCode("某某(集团)")).toEqual({
      name: "某某(集团)",
      code: null,
    });
    expect(splitNameCode("某某(12345)")).toEqual({
      name: "某某(12345)",
      code: null,
    });
  });
});

describe("watchEntityLabel — 自选列表里孪生两份必须长得一样（sway 直报 ⑤）", () => {
  const twinCompany = {
    name: "国盾量子",
    type: "COMPANY" as const,
    ticker: null,
    issuedTicker: "688027",
  };
  const twinStock = {
    name: "国盾量子(688027)",
    type: "STOCK" as const,
    ticker: "688027",
    issuedTicker: null,
  };

  it("公司那份借它发行股票的代码，不再空着", () => {
    expect(watchEntityLabel(twinCompany)).toEqual({
      name: "国盾量子",
      sub: "688027",
    });
  });

  it("股票那份把名字里的代码拆到副行，不重复显示", () => {
    expect(watchEntityLabel(twinStock)).toEqual({
      name: "国盾量子",
      sub: "688027",
    });
  });

  it("同一家公司的两份显示完全一致", () => {
    expect(watchEntityLabel(twinCompany)).toEqual(watchEntityLabel(twinStock));
  });

  it("板块 / 人物没有代码，副行退回类型标签", () => {
    expect(
      watchEntityLabel({
        name: "元件",
        type: "SECTOR",
        ticker: null,
        issuedTicker: null,
      }),
    ).toEqual({ name: "元件", sub: "板块" });
    expect(
      watchEntityLabel({
        name: "赵海军",
        type: "PERSON",
        ticker: null,
        issuedTicker: null,
      }),
    ).toEqual({ name: "赵海军", sub: "人物" });
  });

  it("公司没有发行股票时（孤儿）退回类型标签，不显示空副行", () => {
    expect(
      watchEntityLabel({
        name: "某未上市公司",
        type: "COMPANY",
        ticker: null,
        issuedTicker: null,
      }),
    ).toEqual({ name: "某未上市公司", sub: "公司" });
  });
});
