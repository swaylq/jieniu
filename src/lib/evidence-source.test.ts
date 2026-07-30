import { describe, it, expect } from "vitest";
import {
  classifySourceLevel,
  originFromBrief,
  isHardSource,
  SOURCE_LEVEL_LABEL,
  SOURCE_LEVEL_SHORT,
  type SourceInput,
} from "./evidence-source";

// 来源名与 tier 全部取自真库近 7 天的实际分布，不照想象编。
const s = (o: Partial<SourceInput> & { title: string }): SourceInput => ({
  sourceName: "东方财富·个股资讯",
  tier: "MEDIA",
  brief: "",
  ...o,
});

describe("classifySourceLevel — 张楚寒给的六级", () => {
  it("① 财报 / 交易所公告 / 监管文件", () => {
    expect(
      classifySourceLevel(
        s({ sourceName: "东方财富·公告", tier: "PRIMARY", title: "大普微:2026年半年度业绩预告" }),
      ),
    ).toBe(1);
    expect(
      classifySourceLevel(
        s({ sourceName: "巨潮资讯·公告", tier: "PRIMARY", title: "关于回购股份进展情况的公告" }),
      ),
    ).toBe(1);
    // 交易所自己披露的结构化数据也是一级
    expect(
      classifySourceLevel(
        s({ sourceName: "东方财富·龙虎榜", tier: "PRIMARY", title: "机构专用席位净买入19.97亿元" }),
      ),
    ).toBe(1);
    // 监管文件：问询函
    expect(
      classifySourceLevel(s({ title: "某某股份:关于收到上海证券交易所年报问询函的公告" })),
    ).toBe(1);
  });

  it("② 公司电话会 / 管理层正式披露", () => {
    expect(
      classifySourceLevel(
        s({
          sourceName: "东方财富·公告",
          tier: "PRIMARY",
          title: "东山精密:002384投资者关系活动记录表20260721",
        }),
      ),
    ).toBe(2);
    expect(classifySourceLevel(s({ title: "宁德时代业绩说明会：管理层回应产能规划" }))).toBe(2);
  });

  it("③ 行业销量 / 价格 / 招投标 / 订单数据", () => {
    expect(classifySourceLevel(s({ title: "机构：第二季度智能手机内存价格环比增长超80%" }))).toBe(3);
    expect(classifySourceLevel(s({ title: "美的楼宇中标中国移动低压冷水机组集采项目70%份额" }))).toBe(3);
    expect(
      classifySourceLevel(s({ sourceName: "乘联会", title: "7月新能源乘用车零售同比增长22%" })),
    ).toBe(3);
    // 出处在摘要方括号里
    expect(
      classifySourceLevel(
        s({ title: "存储链排产上调", brief: "【TrendForce】三季度 DRAM 合约价环比上涨。" }),
      ),
    ).toBe(3);
  });

  it("④ 权威媒体报道", () => {
    expect(
      classifySourceLevel(s({ sourceName: "华尔街见闻·A股", title: "半导体芯片股再度走低" })),
    ).toBe(4);
    expect(
      classifySourceLevel(
        s({ title: "长线资金调仓！首批QFII名单出炉", brief: "【21世纪经济报道】截至6月30日…" }),
      ),
    ).toBe(4);
  });

  it("⑤ 券商研报——排在权威媒体前面，因为它是观点不是事实", () => {
    expect(
      classifySourceLevel(s({ sourceName: "东方财富·券商研报", title: "首次覆盖给予买入评级" })),
    ).toBe(5);
    // 权威媒体转载研报，仍然是研报
    expect(
      classifySourceLevel(
        s({ sourceName: "财联社", title: "十多家券商上调目标价 分析师看好存储周期" }),
      ),
    ).toBe(5);
  });

  it("⑥ 市场传闻 / 社交媒体——措辞压过载体", () => {
    expect(classifySourceLevel(s({ title: "网传某公司将获大额订单" }))).toBe(6);
    // 哪怕挂在权威媒体下面，传闻还是传闻
    expect(
      classifySourceLevel(s({ sourceName: "财联社", title: "市场传言公司拟分拆子公司上市" })),
    ).toBe(6);
    expect(
      classifySourceLevel(s({ title: "公司或将扩产", brief: "据悉，知情人士称相关方案仍在讨论。" })),
    ).toBe(6);
  });

  it("认不出出处的聚合站兜底给四级，不是六级——它有编辑问责，只是没写清转自哪儿", () => {
    expect(
      classifySourceLevel(s({ sourceName: "东方财富·快讯", title: "某公司披露回购进展" })),
    ).toBe(4);
  });
});

describe("originFromBrief — 聚合站把真出处写在摘要开头的方括号里", () => {
  it("取得出方括号里的出处", () => {
    expect(originFromBrief("【每日经济新闻】相关个股中，三环集团上涨7.99%")).toBe("每日经济新闻");
    expect(originFromBrief("  【财联社】按照公开承诺…")).toBe("财联社");
  });
  it("没有方括号就返回 null，不瞎猜", () => {
    expect(originFromBrief("澜起科技公告称，公司回购…")).toBeNull();
    expect(originFromBrief("")).toBeNull();
  });
});

describe("isHardSource — 一到三级才够格支撑「已验证」", () => {
  it.each([
    [1, true],
    [2, true],
    [3, true],
    [4, false],
    [5, false],
    [6, false],
  ])("%s → %s", (lv, want) => {
    expect(isHardSource(lv as 1)).toBe(want);
  });
});

describe("标签", () => {
  it("六级都有中文标签与短标签", () => {
    for (const lv of [1, 2, 3, 4, 5, 6] as const) {
      expect(SOURCE_LEVEL_LABEL[lv]).toBeTruthy();
      expect(SOURCE_LEVEL_SHORT[lv]).toBeTruthy();
    }
    expect(SOURCE_LEVEL_LABEL[5]).toBe("券商研报");
    expect(SOURCE_LEVEL_SHORT[1]).toBe("一级·公告");
  });
});
