import { describe, it, expect } from "vitest";
import {
  judgeEvidence,
  dimensionFamily,
  isGenericSpeculation,
  isInferenceChain,
  isOpinionSource,
  gradeLabel,
  keepQualified,
  type EvidenceInput,
} from "./evidence";

// 夹具**全部取自 2026-07-30 线上真实数据**（张楚寒圈红的那三条 + 库里 395 条抽样）。
// 别照类型声明手编（见 lessons.md「类型声明不是事实」）。

const base: Omit<EvidenceInput, "fact" | "dimensionKey"> = {
  why: "",
  subject: "摩尔线程",
  newsTitle: "",
  tier: "MEDIA",
};

const mk = (o: Partial<EvidenceInput>): EvidenceInput => ({
  ...base,
  fact: "",
  dimensionKey: "行业景气",
  ...o,
});

describe("isGenericSpeculation — 通用推测（不是这家公司发生了什么）", () => {
  // 张楚寒圈红②：「重大资产重组『通常』涉及公司战略调整，可能带来积极变化」
  const REAL_GENERIC = [
    "重大资产重组通常涉及公司战略调整，可能带来积极变化",
    "参设并购基金可能为海外市场拓展或产业链整合提供资金支持",
    "价格监管可能影响上游原材料成本传导机制",
    "大规模回购可能反映公司现金流充裕且产能利用率预期向好",
    "注销式回购传递管理层对业务前景的信心，间接支撑市场份额稳定性预期",
    "公司向特定对象发行股票获批，可能用于扩大产能或增加资本开支",
    "掌门人增持计划可能传递对公司未来盈利能力的信心",
    "股价下跌伴随大额回购可能反映产能利用率压力或市场预期转弱",
  ];
  for (const t of REAL_GENERIC) {
    it(`判为通用推测：${t.slice(0, 18)}…`, () => {
      expect(isGenericSpeculation(t)).toBe(true);
    });
  }

  // 自认没内容的（摩尔线程真库里漏网的两条）
  it("「股东会决议公告涉及公司治理，但未披露具体内容」→ 判为通用推测", () => {
    expect(
      isGenericSpeculation("股东会决议公告涉及公司治理，但未披露具体内容"),
    ).toBe(true);
  });
  it("「董事会会议涉及公司治理，但未披露具体内容」→ 判为通用推测", () => {
    expect(
      isGenericSpeculation("董事会会议涉及公司治理，但未披露具体内容"),
    ).toBe(true);
  });
  it("带数字的限定是诚实、不是空洞——不能一起误杀", () => {
    expect(
      isGenericSpeculation("公司公告拟以3亿元-6亿元回购A股股份，未披露资金来源"),
    ).toBe(false);
  });

  // 同批数据里真正合格的——不能误杀
  const REAL_FACTS = [
    "连续5年亏损、累计亏逾10亿元，业绩持续恶化",
    "拟跨界收购骨科耗材资产，标的同样连续亏损",
    "朱一明抛出不低于10亿元远期增持计划，并提议公司回购股份",
    "国务院批复《扩大消费“十五五”规划》",
    "广东辖内15支大行系AIC基金完成工商登记，基金规模合计198亿元",
    "10208万股定增限售股8月4日解禁",
  ];
  for (const t of REAL_FACTS) {
    it(`不误杀真事实：${t.slice(0, 16)}…`, () => {
      expect(isGenericSpeculation(t)).toBe(false);
    });
  }
});

describe("isInferenceChain — 推测链（A 可能反映 B）", () => {
  // 张楚寒圈红③：「净利润预增『可能』反映毛利率改善」
  it("净利大幅预增可能反映毛利率改善 → 是推测链", () => {
    expect(isInferenceChain("净利大幅预增可能反映毛利率改善")).toBe(true);
  });
  it("营收大幅增长表明AI计算和图形处理市场需求强劲 → 是推测链", () => {
    expect(isInferenceChain("营收大幅增长表明AI计算和图形处理市场需求强劲")).toBe(
      true,
    );
  });
  it("直陈事实不算推测链", () => {
    expect(isInferenceChain("上半年营业收入同比增长62%，毛利率提升3.1个百分点")).toBe(
      false,
    );
  });
});

describe("isOpinionSource — 观点 ≠ 事实", () => {
  // 张楚寒圈红①：「研报强调全功能GPU领军地位」拿来验「行业景气」
  it("研报强调领军地位 → 观点", () => {
    expect(isOpinionSource("研报强调全功能GPU领军地位")).toBe(true);
  });
  it("华泰证券维持增持评级 → 观点", () => {
    expect(isOpinionSource("华泰证券维持渣打集团增持评级")).toBe(true);
  });
  it("公司公告的经营数据 → 不是观点", () => {
    expect(isOpinionSource("公司公告上半年归母净利润同比增长62%")).toBe(false);
  });
});

describe("dimensionFamily — 命题分类决定什么样的证据算数", () => {
  it.each([
    ["行业景气", "operating"],
    ["毛利率", "operating"],
    ["毛利率与费用率", "operating"],
    ["大客户/订单", "operating"],
    ["产能/资本开支", "operating"],
    ["市场份额", "operating"],
    ["公司治理", "governance"],
    ["股权结构", "governance"],
    ["政策环境", "external"],
    ["估值与预期", "expectation"],
  ])("%s → %s", (key, family) => {
    expect(dimensionFamily(key)).toBe(family);
  });
});

describe("judgeEvidence — 张楚寒圈红的三条必须全部判废", () => {
  it("① 研报观点验行业景气 → 判废（观点不能证明经营事实）", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "行业景气",
        fact: "研报强调全功能GPU领军地位，反映AI计算和图形处理市场需求",
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.grade).toBe("inference");
    expect(v.reason).toContain("观点");
  });

  it("② 通用推测验公司治理 → 判废", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "公司治理",
        fact: "重大资产重组通常涉及公司战略调整，可能带来积极变化",
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("通用推测");
  });

  it("③ 净利预增验毛利率 → 判废（指标替代）", () => {
    const v = judgeEvidence(
      mk({ dimensionKey: "毛利率", fact: "净利大幅预增可能反映毛利率改善" }),
    );
    expect(v.ok).toBe(false);
  });

  it("③' 就算去掉「可能」，净利润也不能单独证明毛利率", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "毛利率",
        fact: "公司公告上半年归母净利润同比增长62%，达到3.2亿元",
        tier: "PRIMARY",
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("毛利率");
  });
});

describe("judgeEvidence — 合格证据必须留下（判据要有鉴别力，不能一律判废）", () => {
  it("一手公告 + 数字 + 本公司主体 → direct", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "毛利率",
        subject: "摩尔线程",
        fact: "摩尔线程公告上半年毛利率提升至41.2%，同比提高3.1个百分点",
        tier: "PRIMARY",
      }),
    );
    expect(v.ok).toBe(true);
    expect(v.grade).toBe("direct");
  });

  it("同业/上游事实验行业景气 → supporting（是旁证不是直接证据）", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "行业景气",
        subject: "摩尔线程",
        fact: "SK海力士称HBM4下半年扩产，四季度产能已全部售罄",
        tier: "MEDIA",
      }),
    );
    expect(v.ok).toBe(true);
    expect(v.grade).toBe("supporting");
  });

  it("本公司订单事实验大客户/订单 → direct", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "大客户/订单",
        subject: "兆易创新",
        fact: "兆易创新公告中标国家电网2.3亿元采购订单",
        tier: "PRIMARY",
      }),
    );
    expect(v.ok).toBe(true);
  });

  it("券商评级验「估值与预期」是对应的 → 留下", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "估值与预期",
        subject: "渣打集团",
        fact: "华泰证券维持渣打集团增持评级，目标价上调至120港元",
      }),
    );
    expect(v.ok).toBe(true);
  });
});

// 以下三条全部来自真实探针输出（deepseek 对真库资讯的响应），不是手编夹具。
describe("judgeEvidence — 指标族：一个命题盯多个指标时，满足其一即可", () => {
  it("「现金流与资本开支」+ 回购事实 → 留下（别用产能族去否决现金那一半）", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "现金流与资本开支",
        subject: "澜起科技",
        fact: "澜起科技公告首次回购A股50万股，回购金额约1.03亿元",
      }),
    );
    expect(v.ok).toBe(true);
  });

  it("「内存接口芯片份额与定价」+ 机构调研热度 → 判废（调研次数不是份额也不是价格）", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "内存接口芯片份额与定价",
        subject: "澜起科技",
        fact: "澜起科技7月内接待超过200家机构调研",
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("份额");
  });

  it("「行业景气」+ 同业净利暴增 → 留下（旁证，why 里说明局限）", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "行业景气",
        subject: "江波龙",
        fact: "江波龙预计2026年上半年归母净利润92亿至110亿元，同比增62204%至74394%",
        why: "净利润大幅增长表明行业景气向好；但单家公司数据不代表全行业",
      }),
    );
    expect(v.ok).toBe(true);
  });
});

describe("judgeEvidence — 无锚点 / 综述体裁", () => {
  it("没有任何事实锚点 → 判废", () => {
    const v = judgeEvidence(mk({ fact: "公司经营情况良好，发展态势稳中向好" }));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("锚点");
  });

  // 综述体裁不能一刀切判废——实测那样会把「国务院批复《扩大消费十五五规划》」这类
  // 真·政策事实整批误杀。真正要挡的是「早报里讲**别家公司**的事，被当成这家公司的证据」。
  it("早报里讲的是别家公司的事 → 判废", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "技术创新",
        subject: "摩尔线程",
        fact: "豪能股份拟投资10亿元建设机器人关节减速器生产基地",
        newsTitle: "新华财经早报：7月30日",
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("综述");
  });

  it("早报里确实讲这家公司、且有锚点 → 留下，但只算旁证（二手来源）", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "财务状况",
        subject: "西部矿业",
        fact: "西部矿业半年报净利润同比增长38%，达到21.4亿元",
        newsTitle: "新华财经早报：7月30日",
        tier: "PRIMARY",
      }),
    );
    expect(v.ok).toBe(true);
    expect(v.grade).toBe("supporting");
  });

  it("政策类命题吃得下综述体裁里的宏观事实（外部命题本就靠外部事实）", () => {
    const v = judgeEvidence(
      mk({
        dimensionKey: "政策环境",
        subject: "中国国旅",
        fact: "国务院批复《扩大消费“十五五”规划》",
        newsTitle: "【风口研报】扩内需政策加码 食品饮料有望迎估值修复新机遇",
      }),
    );
    expect(v.ok).toBe(true);
    expect(v.grade).toBe("supporting");
  });

  it("空 fact → 判废", () => {
    expect(judgeEvidence(mk({ fact: "   " })).ok).toBe(false);
  });
});

describe("keepQualified — 批量过滤，且要能回答「丢了多少、为什么」", () => {
  it("返回留下的 + 判废统计", () => {
    const items = [
      mk({ dimensionKey: "公司治理", fact: "重大资产重组通常涉及公司战略调整" }),
      mk({
        dimensionKey: "大客户/订单",
        subject: "兆易创新",
        fact: "兆易创新公告中标国家电网2.3亿元采购订单",
        tier: "PRIMARY",
      }),
    ];
    const r = keepQualified(items);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]!.verdict.reason).toBeTruthy();
    expect(r.kept[0]!.verdict.grade).toBe("direct");
  });
});

describe("gradeLabel", () => {
  it("给用户看的中文标签", () => {
    expect(gradeLabel("direct")).toBe("直接证据");
    expect(gradeLabel("supporting")).toBe("旁证");
    expect(gradeLabel("inference")).toBe("推测");
  });
});
