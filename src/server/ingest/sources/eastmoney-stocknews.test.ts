import { describe, it, expect } from "vitest";
import { mentions } from "./eastmoney-stocknews";

// 夹具全部取自 2026-08-03 库里的真实数据。
describe("mentions — 搜索结果里到底提没提到我们搜的这只股", () => {
  it("【真实反例】搜「携程」搜不到东西时，接口退化成返回通用最新资讯", () => {
    for (const t of [
      "江苏靖江 深耕制造立市 做强县域经济",
      "上半年上海网络游戏总收入超950亿元！两个报告透露出什么讯息？",
      "焦作万方：目前重组处于深交所问询回复阶段\n【证券日报】8月3日，焦作万方在互动平台回答投资者提问时表示…",
    ]) {
      expect(mentions(t, "携程", "TCOM")).toBe(false);
    }
  });

  it("真提到了就认——标题或摘要任一处即可", () => {
    expect(mentions("携程发布二季度财报，营收同比增长", "携程", "TCOM")).toBe(true);
    expect(
      mentions("在线旅游平台竞争加剧\n【财联社】携程、同程等平台补贴力度加大", "携程", "TCOM"),
    ).toBe(true);
  });

  it("按六位代码也认", () => {
    expect(mentions("688027 盘中触及涨停", "国盾量子", "688027")).toBe(true);
  });

  it("名字自带的「(代码)」「-U」装饰不参与比对", () => {
    expect(mentions("摩尔线程完成Kimi K3适配", "摩尔线程-U", "688795")).toBe(true);
    expect(mentions("国盾量子：签订量子保密通信网络合同", "国盾量子(688027)", "688027")).toBe(true);
  });

  it("单字名字不拿来匹配（会命中一切）", () => {
    expect(mentions("光刻机产业链全线走强", "光", "000001")).toBe(false);
  });
});
