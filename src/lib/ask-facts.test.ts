import { describe, it, expect } from "vitest";
import {
  renderAskFacts,
  factCount,
  invalidCitations,
  ungroundedNumbers,
  questionTerms,
  relevanceScore,
  type AskFact,
} from "./ask-facts";

// 夹具取自 2026-08-04 库里的真实数据（Alley_Stella 点的就是这条）。
const FOCUS: AskFact = {
  title: "麒盛科技：预计上半年净利润同比减少66.97%至75.58%",
  body: "【南方财经网】南财智讯7月14日电，麒盛科技发布中期业绩预告，预计上半年净利润2580.00万元至3490.00万元，同比减少66.97%至75.58%。2026年上半年业绩减少主要系受美元汇率波动影响，本报告期汇兑损失增加。",
  tier: "MEDIA",
  sourceName: "东方财富·个股资讯",
  publishedAt: new Date("2026-07-14T09:00:00+08:00"),
  url: "http://finance.eastmoney.com/a/x.html",
  kind: "own",
};

const PEER: AskFact = {
  title: "汇兑损失与费用投入增加 多家A股睡眠家居企业利润下滑",
  body: "【证券时报网】2026年上半年，ST喜临门、梦百合、麒盛科技等头部企业净利润普遍下滑，汇兑损失与费用投入加大成为共性原因。",
  tier: "MEDIA",
  sourceName: "东方财富·个股资讯",
  publishedAt: new Date("2026-07-28T09:00:00+08:00"),
  url: null,
  kind: "mention",
};

/** 一手公告：summary 就是标题本身（实测近 30 天 63% 如此），摘录得靠正文。 */
const FILING: AskFact = {
  title: "麒盛科技:麒盛科技2026年半年度业绩预告公告",
  body: "证券代码：603610 证券简称：麒盛科技 公告编号：2026-041 麒盛科技股份有限公司2026年半年度业绩预告公告 本公司董事会及全体董事保证本公告内容不存在任何虚假记载、误导性陈述或者重大遗漏，并对其内容的真实性、准确性和完整性承担法律责任。 一、本期业绩预告情况 预计实现归属于母公司所有者的净利润2,580.00万元至3,490.00万元。",
  tier: "PRIMARY",
  sourceName: "东方财富·公告",
  publishedAt: new Date("2026-07-14T18:00:00+08:00"),
  url: null,
  kind: "own",
};

describe("renderAskFacts", () => {
  it("带编号 / 日期 / 层级 / 来源 —— 出处要能让用户一眼核对", () => {
    const s = renderAskFacts({ focus: FOCUS, facts: [PEER], subjects: ["麒盛科技"] });
    expect(s).toContain("[1] 2026-07-14 · 媒体 · 东方财富·个股资讯 · 麒盛科技：预计上半年净利润");
    expect(s).toContain("[2] 2026-07-28");
    expect(s).toContain("[1] 是他正在看的那一条");
  });

  it("【真实现场】用户正在看的那条要带出「汇兑损失」那句——答案就在这里", () => {
    const s = renderAskFacts({ focus: FOCUS, facts: [], subjects: [] });
    expect(s).toContain("受美元汇率波动影响");
    expect(s).toContain("汇兑损失增加");
  });

  it("一手公告的法务套话被剥掉，留下真正说事的那段", () => {
    const s = renderAskFacts({ focus: null, facts: [FILING], subjects: [] });
    expect(s).toContain("2,580.00万元至3,490.00万元");
    expect(s).not.toContain("虚假记载");
    expect(s).not.toContain("证券代码");
  });

  it("没有事实时返回空串——调用方据此改口径，而不是硬编", () => {
    expect(renderAskFacts({ focus: null, facts: [], subjects: [] })).toBe("");
    expect(factCount({ focus: null, facts: [], subjects: [] })).toBe(0);
    expect(factCount({ focus: FOCUS, facts: [PEER], subjects: [] })).toBe(2);
  });
});

describe("invalidCitations — 引用了不存在的出处就是编的", () => {
  it("越界编号被抓出来", () => {
    expect(invalidCitations("受汇率影响[1]，同业普遍下滑[2]，董秘也确认了[5]", 2)).toEqual([5]);
  });
  it("合法引用不报", () => {
    expect(invalidCitations("受汇率影响[1]，同业普遍下滑[2]", 2)).toEqual([]);
  });
  it("一条事实都没给却引用了出处", () => {
    expect(invalidCitations("原因见[1]", 0)).toEqual([1]);
  });
  it("没有引用不报错", () => {
    expect(invalidCitations("这条我没有查到依据", 3)).toEqual([]);
  });
});

describe("ungroundedNumbers — 带单位的数字必须来自语料", () => {
  const corpus = renderAskFacts({ focus: FOCUS, facts: [PEER], subjects: [] });

  it("语料里有的数字放行（含千分位与小数末尾 0 的写法差异）", () => {
    expect(ungroundedNumbers("净利润同比减少66.97%至75.58%", corpus)).toEqual([]);
    expect(ungroundedNumbers("预计净利润2580万元", corpus)).toEqual([]);
    expect(ungroundedNumbers("预计净利润2,580.00万元", corpus)).toEqual([]);
  });

  it("【真实反例】模型自己造的数字被抓出来", () => {
    expect(ungroundedNumbers("去年同期有一笔3.2亿元的股权处置收益", corpus)).toEqual(["3.2亿元"]);
  });

  it("裸数字与个位数不查——「过去5年」是行文不是财务事实", () => {
    expect(ungroundedNumbers("过去5年公司持续投入", corpus)).toEqual([]);
    expect(ungroundedNumbers("有3家同业一起下滑", corpus)).toEqual([]);
  });

  it("没有数字时安静通过", () => {
    expect(ungroundedNumbers("主要受汇率波动影响", corpus)).toEqual([]);
  });
});

describe("questionTerms / relevanceScore — 挑跟问题有关的那几条", () => {
  it("疑问句里的套话不当检索词", () => {
    const t = questionTerms("为什么上半年利润降这么多");
    expect(t).not.toContain("为什");
    expect(t).not.toContain("什么");
    expect(t).not.toContain("这么");
    expect(t).toContain("上半");
    expect(t).toContain("利润");
  });

  it("【真实反例】问利润为什么降，就不该挑到当天的行情稿", () => {
    const terms = questionTerms("为什么上半年利润降这么多");
    const onTopic: AskFact = {
      title: "汇兑损失与费用投入增加 多家A股睡眠家居企业利润下滑",
      body: "2026年上半年，ST喜临门、梦百合、麒盛科技等头部企业净利润普遍下滑",
      tier: "MEDIA",
      sourceName: "x",
      publishedAt: new Date("2026-07-28"),
      url: null,
      kind: "mention",
    };
    const offTopic: AskFact = {
      title: "超半数装修建材股实现增长 雄塑科技股价涨幅11.72%",
      body: "麒盛科技以14.50元/股收盘，涨幅为10.02%",
      tier: "MEDIA",
      sourceName: "x",
      publishedAt: new Date("2026-08-03"),
      url: null,
      kind: "mention",
    };
    expect(relevanceScore(onTopic, terms)).toBeGreaterThan(
      relevanceScore(offTopic, terms),
    );
  });

  it("英文/代码也认", () => {
    expect(questionTerms("MU 最近怎么样")).toContain("MU");
  });
});
