import { describe, it, expect } from "vitest";
import {
  hasFactAnchor,
  isCircularAttribution,
  isSubstantive,
  keepSubstantive,
  classifyScope,
  isMarketLevelWorthy,
  summarizeBreadth,
  isVacuousWatchpoint,
  isValidAttribution,
} from "./digest-substance";

// 反例夹具**全部取自 2026-07-28 线上真实生成的那条复盘**（张楚寒圈出来的就是这些）；
// 正例取自同日库里真实存在、却被选材丢掉的条目。别照类型声明手编夹具（见 lessons.md）。
const REAL_WASTE = [
  "半导体板块集体下挫，拖累科技股表现。",
  "科技股整体回调，股价大幅下跌。",
  "半导体板块走弱，拖累个股表现。",
  "科技股普遍下跌，股价承压。",
  "半导体板块领跌，股价跌停。",
  "元件板块走弱，股价跌停。",
  "半导体设备股受板块拖累。",
  "跟随半导体板块下跌，技术面走弱。",
  "受科技股整体疲软拖累。",
  "存储周期逻辑受半导体板块整体走弱压制",
  "今日跌幅有限，受能源金属板块走弱影响",
];

const REAL_SUBSTANCE = [
  "央行今日开展2065亿元7天期逆回购操作，操作利率1.40%，持平上次。",
  "SK海力士：HBM4将于下半年扩大生产。",
  "韩国首尔综指大跌8%，接近触发熔断。",
  "机构：第二季度智能手机内存价格环比增长超80%。",
  "中际旭创董事长提议40亿元至80亿元回购股份。",
  "强生拟以55亿美元解决滑石粉诉讼。",
  "美国联邦通信委员会更新《受限设备清单》，电力逆变器原则上无法取得设备授权。",
  "5家机构专用席位净买入19.97亿元。",
  "美伊局势出现停火预期，油价回落。",
];

describe("循环归因判废", () => {
  it("线上真实产出的每一条废话都要被判掉", () => {
    for (const t of REAL_WASTE) {
      expect(isCircularAttribution(t), t).toBe(true);
      expect(isSubstantive(t), t).toBe(false);
    }
  });

  it("带了数字的循环归因照样判废——「板块领跌，股价跌停」不是解释", () => {
    expect(hasFactAnchor("半导体板块领跌，股价跌停。")).toBe(true); // 有「跌停」事件锚点
    expect(isSubstantive("半导体板块领跌，股价跌停。")).toBe(false); // 但仍是循环
  });

  // 2026-08-03 复核线上 note 时发现的同族漏网：主语换成「概念 / 题材 / 赛道」，
  // 中间不带逗号、用「带动」直接连到股价，原来六条一条都拦不住。
  it("概念 / 题材 / 赛道「回升带动股价」同样是循环归因", () => {
    expect(isCircularAttribution("存储芯片概念震荡回升带动股价冲高")).toBe(true);
    expect(isCircularAttribution("光模块题材走强推动股价上涨")).toBe(true);
    expect(isCircularAttribution("量子赛道升温提振股价表现")).toBe(true);
  });

  it("但「行业景气回升带动订单增长」是真解释——落点不是股价就不判", () => {
    expect(isCircularAttribution("行业景气回升带动订单增长")).toBe(false);
    expect(isCircularAttribution("存储涨价带动毛利率改善")).toBe(false);
  });
});

describe("事实锚点", () => {
  it("真实的增量信息全部留下", () => {
    for (const t of REAL_SUBSTANCE) {
      expect(isCircularAttribution(t), t).toBe(false);
      expect(isSubstantive(t), t).toBe(true);
    }
  });

  it("无锚点的正确废话也留不下", () => {
    expect(isSubstantive("市场情绪偏谨慎，投资者观望气氛浓厚")).toBe(false);
    expect(isSubstantive("资金避险需求推动上涨")).toBe(false);
    expect(isSubstantive("低估值优势吸引避险资金流入")).toBe(false);
  });

  it("太短的不算", () => {
    expect(isSubstantive("上涨")).toBe(false);
  });

  it("keepSubstantive 混合输入只留有料的", () => {
    const kept = keepSubstantive([...REAL_WASTE.slice(0, 3), ...REAL_SUBSTANCE.slice(0, 3)]);
    expect(kept).toHaveLength(3);
    expect(kept[0]).toContain("2065亿元");
  });
});

describe("国际 / 国内 / 产业分层", () => {
  it("海外优先——A股当天最大的外生变量常在海外", () => {
    expect(classifyScope("韩国首尔综指大跌8%，接近触发熔断。")).toBe("overseas");
    expect(classifyScope("今晚美联储决议五类情境剖析")).toBe("overseas");
    expect(classifyScope("SK海力士：HBM4将于下半年扩大生产")).toBe("overseas");
    expect(classifyScope("强生拟以55亿美元解决滑石粉诉讼")).toBe("overseas");
  });

  it("国内宏观：货币 / 部委 / 监管", () => {
    expect(classifyScope("央行今日开展2065亿元7天期逆回购操作")).toBe("domestic");
    expect(classifyScope("住建部：扎实做好国债支持老旧小区加装电梯项目组织实施")).toBe("domestic");
    expect(classifyScope("中小金融机构改革化险路接下来怎么走？金融监管总局最新定调")).toBe("domestic");
  });

  it("其余落产业与公司", () => {
    expect(classifyScope("多家A股企业业绩高增，京东方A、海亮股份等抛出大额增持计划")).toBe("industry");
    expect(classifyScope("“废里淘金” 多家环保资源化企业上半年业绩预喜")).toBe("industry");
  });
});

describe("市场级选材", () => {
  it("剔掉个股盘口碎讯与导航体裁", () => {
    expect(isMarketLevelWorthy("长鹰硬科龙虎榜数据（7月28日）")).toBe(false);
    expect(isMarketLevelWorthy("益坤电气换手率47.47%，龙虎榜上榜营业部合计净卖出1461.30万元")).toBe(false);
    expect(isMarketLevelWorthy("盘前必读丨日韩股市高开SK海力士涨逾2%")).toBe(false);
    expect(isMarketLevelWorthy("周三（7月29日）重点关注财经事件和经济数据")).toBe(false);
    expect(isMarketLevelWorthy("央行今日开展2065亿元7天期逆回购操作")).toBe(true);
  });

  // 选材本体（分层限量 / 折叠跨源重复 / 相关性排序 / 同主体收口）在 macro-relevance.test.ts
});

describe("市场宽度", () => {
  it("涨跌家数 / 涨跌停 / 中位数", () => {
    const b = summarizeBreadth([
      { changePct: 10 },
      { changePct: 3.2 },
      { changePct: 0 },
      { changePct: -1.5 },
      { changePct: -10 },
    ]);
    expect(b).toEqual({
      counted: 5,
      up: 2,
      down: 2,
      flat: 1,
      limitUp: 1,
      limitDown: 1,
      medianChangePct: 0,
    });
  });

  it("偶数样本取中间两个的均值；非有限值不计入", () => {
    const b = summarizeBreadth([
      { changePct: 1 },
      { changePct: 2 },
      { changePct: 3 },
      { changePct: 4 },
      { changePct: NaN },
    ]);
    expect(b.counted).toBe(4);
    expect(b.medianChangePct).toBe(2.5);
  });

  it("空输入不伪造 0%", () => {
    expect(summarizeBreadth([]).medianChangePct).toBeNull();
  });
});

describe("关注点的废话形态（比归因判得松：明天要验证的事未必挂得上今天的锚点）", () => {
  it("泛泛的板块/情绪问句判废——线上真实产出的那几条", () => {
    for (const t of [
      "半导体板块能否止跌企稳，关注行业景气度变化。",
      "防御性板块如白酒、银行的持续性。",
      "市场情绪是否进一步恶化，关注资金流向。",
      "关注能源金属板块的后续走势",
      "留意市场情绪变化",
      "半导体板块情绪是否企稳",
    ]) {
      expect(isVacuousWatchpoint(t), t).toBe(true);
    }
  });

  it("指向具体事件/主体的留下——包括很短的那种", () => {
    for (const t of [
      "美联储议息",
      "兆易创新半年报披露时点",
      "东方证券收购上海证券的进展及监管审批情况。",
      "宁德时代回购方案细节披露",
      "澜起科技机构调研传导效应",
    ]) {
      expect(isVacuousWatchpoint(t), t).toBe(false);
    }
  });
});

describe("归因判据用「该标的当天有没有事实」，不靠词表", () => {
  it("没有自有事实 → 再像样的归因也作废（模型此时只会编）", () => {
    expect(isValidAttribution("PCB 订单超预期带动估值修复", false)).toBe(false);
  });

  it("有自有事实 → 不必命中锚点词表也留得下（实测 MSCI 就不在词表里）", () => {
    expect(isValidAttribution("纳入MSCI指数预期推动资金抢筹", true)).toBe(true);
  });

  it("循环归因与纯方向复述，有事实也拦得住", () => {
    expect(isValidAttribution("受半导体板块影响走跌", true)).toBe(false);
    expect(isValidAttribution("板块走强", true)).toBe(false);
    expect(isValidAttribution("股价承压。", true)).toBe(false);
    expect(isValidAttribution("资金流入明显", true)).toBe(false); // 短且无锚点＝复述
  });
});
