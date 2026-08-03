import { describe, it, expect } from "vitest";
import {
  cleanSecurityName,
  subjectTokens,
  titleNamesSubject,
  isOwnFact,
  pickSubjectFacts,
} from "./news-subject";

// 夹具**全部取自 2026-08-03 线上真实数据**（潞直报那条国盾量子归因的现场），
// 不照类型声明手编（见 lessons.md「类型声明不是事实」）。
const GUODUN = {
  name: "国盾量子(688027)",
  shortName: null,
  aliases: [],
  ticker: "688027",
};

/** 潞截图里那条错归因的两条「今日相关」——两条都是频准激光的报道，国盾量子只是被列举的客户。 */
const MENTION_ONLY = [
  "本周，A股“光”和“芯”新股都来了",
  "闯关科创板！频准激光全链条自研破局 发力量子与半导体赛道",
];

describe("cleanSecurityName — 剥掉证券简称的装饰", () => {
  it("剥尾部代码括注", () => {
    expect(cleanSecurityName("国盾量子(688027)")).toBe("国盾量子");
    expect(cleanSecurityName("兆易创新（603986）")).toBe("兆易创新");
  });

  it("剥 -U / -UW 后缀（未盈利 / 同股不同权）", () => {
    expect(cleanSecurityName("摩尔线程-U")).toBe("摩尔线程");
    expect(cleanSecurityName("大普微-UW")).toBe("大普微");
  });

  it("剥 N / C / ST 等交易状态前缀", () => {
    expect(cleanSecurityName("C华润")).toBe("华润");
    expect(cleanSecurityName("N曦智")).toBe("曦智");
    expect(cleanSecurityName("*ST东园")).toBe("东园");
  });

  it("不动正常名字", () => {
    expect(cleanSecurityName("中航光电")).toBe("中航光电");
  });
});

describe("subjectTokens — 一家公司的全部叫法", () => {
  it("收名字/简称/别名/代码，去重且丢掉单字（单字会命中一切）", () => {
    expect(
      subjectTokens({
        name: "长鑫科技(688981)",
        shortName: "长鑫科技",
        aliases: ["长鑫存储", "C"],
        ticker: "688981",
      }),
    ).toEqual(["长鑫科技", "长鑫存储", "688981"]);
  });
});

describe("titleNamesSubject — 标题里有没有点到这家公司", () => {
  it("【真实反例】只在正文/摘要里被列举为客户的，不算", () => {
    for (const t of MENTION_ONLY) {
      expect(titleNamesSubject(t, GUODUN)).toBe(false);
    }
  });

  it("公司自己的公告与快讯算", () => {
    expect(
      titleNamesSubject("澜起科技：首次回购50万股A股股份 回购金额约1.03亿元", {
        name: "澜起科技(688008)",
        ticker: "688008",
      }),
    ).toBe(true);
    expect(
      titleNamesSubject("摩尔线程完成Kimi K3适配", { name: "摩尔线程-U" }),
    ).toBe(true);
  });

  it("标题只带代码也算", () => {
    expect(titleNamesSubject("688027 盘中触及涨停", GUODUN)).toBe(true);
  });

  it("【真实反例】讲别家公司、只在摘要里提到它的，不算", () => {
    expect(
      titleNamesSubject("硬科技龙头为何能摘掉H股“折价标签”", {
        name: "澜起科技(688008)",
        ticker: "688008",
      }),
    ).toBe(false);
    expect(
      titleNamesSubject("老基金出现新面貌", { name: "东山精密(002384)", ticker: "002384" }),
    ).toBe(false);
  });

  it("别名命中", () => {
    expect(
      titleNamesSubject("长鑫存储启动新一轮扩产", {
        name: "长鑫科技(688981)",
        aliases: ["长鑫存储"],
      }),
    ).toBe(true);
  });

  it("空标题不算", () => {
    expect(titleNamesSubject("   ", GUODUN)).toBe(false);
  });
});

describe("isOwnFact — 权威体裁的标题可以不带公司名", () => {
  const dongshan = [{ name: "东山精密", ticker: null }, { name: "东山精密(002384)", ticker: "002384" }];

  it("【真实反例】巨潮体裁的一手公告：标题不带名字，但主体是源给的", () => {
    expect(
      isOwnFact(
        { title: "关于回购公司股份的进展公告", sourceKind: "official-filing", boundEntityCount: 2 },
        dongshan,
      ),
    ).toBe(true);
  });

  it("权威体裁但绑了第二家公司 → 是正文顺带提及的误绑，不算", () => {
    // 实测：「关于深圳嘉立创…股票上市交易的公告」绑到了平安银行
    expect(
      isOwnFact(
        {
          title: "关于深圳嘉立创科技集团股份有限公司股票上市交易的公告",
          sourceKind: "official-filing",
          boundEntityCount: 4,
        },
        [{ name: "平安银行", ticker: "000001" }],
      ),
    ).toBe(false);
  });

  it("媒体源不享受这条豁免——标题没点名就是没点名", () => {
    expect(
      isOwnFact(
        { title: "老基金出现新面貌", sourceKind: "json-api", boundEntityCount: 2 },
        dongshan,
      ),
    ).toBe(false);
  });

  it("媒体源标题点名了就算", () => {
    expect(
      isOwnFact(
        { title: "东山精密已累计回购25.52万股 成交总额近5000万元", sourceKind: "json-api", boundEntityCount: 2 },
        dongshan,
      ),
    ).toBe(true);
  });

  it("缺 sourceKind / boundEntityCount 时退化成「只认标题」，不放行", () => {
    expect(isOwnFact({ title: "关于回购公司股份的进展公告" }, dongshan)).toBe(false);
  });
});

describe("pickSubjectFacts — 只留主体是它的那些", () => {
  const twin = [
    { name: "国盾量子", ticker: null },
    { name: "国盾量子(688027)", ticker: "688027" },
  ];

  it("【真实现场】两条 mention-only 全部剔掉 → 这只股当天没有自有事实", () => {
    expect(pickSubjectFacts(MENTION_ONLY.map((title) => ({ title })), twin)).toEqual([]);
  });

  it("保留主体命中的，按入参顺序，并按标题去重", () => {
    const rows = [
      { title: "本周，A股“光”和“芯”新股都来了" },
      { title: "国盾量子：签订量子保密通信网络建设合同" },
      { title: "国盾量子：签订量子保密通信网络建设合同" },
      { title: "国盾量子获纳入上证科创板50成份指数" },
    ];
    expect(pickSubjectFacts(rows, twin)).toEqual([
      "国盾量子：签订量子保密通信网络建设合同",
      "国盾量子获纳入上证科创板50成份指数",
    ]);
  });

  it("limit 截断", () => {
    const rows = [
      { title: "国盾量子：第一件事" },
      { title: "国盾量子：第二件事" },
      { title: "国盾量子：第三件事" },
    ];
    expect(pickSubjectFacts(rows, twin, 2)).toHaveLength(2);
  });
});
