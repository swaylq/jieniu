import { describe, it, expect } from "vitest";
import {
  categorize,
  mergeEvents,
  scoreEvent,
  selectEvents,
  coverageReport,
  CATEGORY_LABEL,
  CATEGORIES,
  type RawEvent,
  type RankContext,
} from "./digest-pipeline";

const at = (h: number) => new Date(2026, 6, 30, h, 0, 0);

const ev = (o: Partial<RawEvent> & { id: string; title: string }): RawEvent => ({
  brief: "",
  source: "财联社",
  tier: "MEDIA",
  importance: 50,
  publishedAt: at(10),
  entityNames: [],
  entityIds: [],
  entityTypes: [],
  eventType: null,
  ...o,
});

describe("categorize — 张楚寒要的六类：宏观/全球市场/行业/公司/资金/日历", () => {
  it("六类齐全，标签是中文", () => {
    expect(CATEGORIES).toEqual([
      "global",
      "macro",
      "industry",
      "company",
      "flow",
      "calendar",
    ]);
    expect(CATEGORY_LABEL.global).toBe("全球市场");
    expect(CATEGORY_LABEL.flow).toBe("资金");
  });

  it.each([
    ["SK海力士称HBM4下半年扩产，四季度产能售罄", [], "global"],
    ["美联储维持利率不变，鲍威尔称通胀仍具粘性", [], "global"],
    ["央行开展2065亿元7天期逆回购，利率持平1.40%", [], "macro"],
    ["国务院批复《扩大消费“十五五”规划》", [], "macro"],
    ["北向资金今日净买入80.3亿元", [], "flow"],
    ["江波龙大宗交易：2笔共451万元", ["江波龙"], "flow"],
    ["存储芯片现货价格环比上涨15%", [], "industry"],
    ["江波龙预计上半年归母净利润92亿至110亿元", ["江波龙"], "company"],
  ])("%s → %s", (title, names, want) => {
    expect(
      categorize(
        ev({
          id: "x",
          title,
          entityNames: names,
          entityTypes: names.map(() => "COMPANY"),
        }),
      ),
    ).toBe(want);
  });

  it("资金体裁优先于公司绑定——龙虎榜绑了个股，但它讲的是资金不是公司", () => {
    const e = ev({
      id: "1",
      title: "龙虎榜：机构专用席位净买入19.97亿元",
      entityNames: ["东山精密"],
      entityTypes: ["COMPANY"],
    });
    expect(categorize(e)).toBe("flow");
  });

  it("海外优先于公司绑定——台积电的事属于全球市场那一层", () => {
    const e = ev({
      id: "2",
      title: "台积电上调全年资本开支至420亿美元",
      entityNames: ["台积电"],
      entityTypes: ["COMPANY"],
    });
    expect(categorize(e)).toBe("global");
  });

  it("日历类由披露日程注入，标题里带「预约披露」也能识别", () => {
    expect(categorize(ev({ id: "3", title: "半年报预约披露截止日为8月31日" }))).toBe(
      "calendar",
    );
  });
});

describe("mergeEvents — 去重并合并同一主题的多条新闻", () => {
  it("同一件事的跨源重复合并成一条，保留最权威那条", () => {
    const a = ev({
      id: "a",
      title: "澜起科技：首次回购50万股A股股份 回购金额约1.03亿元",
      source: "东方财富·快讯",
      tier: "MEDIA",
      entityIds: ["e1"],
      entityNames: ["澜起科技"],
      entityTypes: ["COMPANY"],
    });
    const b = ev({
      id: "b",
      title:
        "澜起科技：公司通过集中竞价交易方式首次回购A股股份50万股，支付金额约1.03亿元",
      source: "公司公告",
      tier: "PRIMARY",
      entityIds: ["e1"],
      entityNames: ["澜起科技"],
      entityTypes: ["COMPANY"],
    });
    const merged = mergeEvents([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.tier).toBe("PRIMARY"); // 一手来源胜出
    expect(merged[0]!.mergedCount).toBe(2);
    expect(merged[0]!.sources).toContain("东方财富·快讯");
  });

  it("语序打乱的重复也要合并（前缀子串判定拦不住）", () => {
    const a = ev({ id: "a", title: "业绩确定叠加分红稳定 沪主板蓝筹走强" });
    const b = ev({ id: "b", title: "沪主板蓝筹逆势走强 业绩确定叠加分红稳定" });
    expect(mergeEvents([a, b])).toHaveLength(1);
  });

  it("不同主体的同类事件**不能**合并", () => {
    const a = ev({
      id: "a",
      title: "澜起科技首次回购50万股",
      entityIds: ["e1"],
      entityNames: ["澜起科技"],
    });
    const b = ev({
      id: "b",
      title: "江波龙首次回购50万股",
      entityIds: ["e2"],
      entityNames: ["江波龙"],
    });
    expect(mergeEvents([a, b])).toHaveLength(2);
  });
});

const ctx = (o: Partial<RankContext> = {}): RankContext => ({
  now: at(15),
  hotSubjects: new Set<string>(),
  heldSubjects: new Set<string>(),
  thesisTouched: new Set<string>(),
  ...o,
});

describe("scoreEvent — 张楚寒给的六条排序判据，每条都要能单独看到贡献", () => {
  const base = {
    ...ev({
      id: "x",
      title: "某公司公告扩产计划",
      entityNames: ["甲公司"],
      entityIds: ["e1"],
    }),
    mergedCount: 1,
    sources: ["财联社"],
    category: "company" as const,
  };

  it("六条判据全部出现在 reasons 里（可观测，不是黑箱分数）", () => {
    const s = scoreEvent(base, ctx());
    expect(Object.keys(s.reasons).sort()).toEqual(
      [
        "与当日涨跌的解释力",
        "信息新鲜度",
        "market",
        "多源印证",
        "来源可靠性",
        "是否改变投资逻辑",
        "用户持仓相关度",
      ].sort(),
    );
  });

  it("与当日涨跌有解释力的加分", () => {
    const plain = scoreEvent(base, ctx());
    const hot = scoreEvent(base, ctx({ hotSubjects: new Set(["甲公司"]) }));
    expect(hot.reasons["与当日涨跌的解释力"]!).toBeGreaterThan(
      plain.reasons["与当日涨跌的解释力"]!,
    );
    expect(hot.score).toBeGreaterThan(plain.score);
  });

  it("与用户持仓相关的加分最重——这份复盘是写给他的", () => {
    const held = scoreEvent(base, ctx({ heldSubjects: new Set(["甲公司"]) }));
    expect(held.reasons["用户持仓相关度"]!).toBeGreaterThan(0);
  });

  it("改变了投资逻辑的加分", () => {
    const t = scoreEvent(base, ctx({ thesisTouched: new Set(["x"]) }));
    expect(t.reasons["是否改变投资逻辑"]!).toBeGreaterThan(0);
  });

  it("新鲜度随时间衰减", () => {
    const fresh = scoreEvent({ ...base, publishedAt: at(14) }, ctx());
    const stale = scoreEvent({ ...base, publishedAt: at(2) }, ctx());
    expect(fresh.reasons["信息新鲜度"]!).toBeGreaterThan(
      stale.reasons["信息新鲜度"]!,
    );
  });

  it("一手来源比媒体可靠", () => {
    const primary = scoreEvent({ ...base, tier: "PRIMARY" }, ctx());
    const media = scoreEvent({ ...base, tier: "MEDIA" }, ctx());
    expect(primary.reasons["来源可靠性"]!).toBeGreaterThan(
      media.reasons["来源可靠性"]!,
    );
  });

  it("多源同时报道 = 更重要", () => {
    const multi = scoreEvent({ ...base, mergedCount: 3 }, ctx());
    expect(multi.reasons["多源印证"]!).toBeGreaterThan(0);
  });
});

describe("selectEvents — 从候选里选 15-25 条，且每类都有配额", () => {
  const many = (cat: string, n: number, baseScore: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...ev({ id: `${cat}${i}`, title: `${cat} 事件 ${i}` }),
      mergedCount: 1,
      sources: ["s"],
      category: cat as never,
      score: baseScore - i,
      reasons: {},
    }));

  it("上限 25、下限尽量 15", () => {
    const picked = selectEvents(many("company", 60, 100), {
      min: 15,
      max: 25,
      perCategoryFloor: 2,
      perCategoryCap: 8,
    });
    expect(picked.length).toBeLessThanOrEqual(25);
    expect(picked.length).toBeGreaterThanOrEqual(15);
  });

  it("单类不能吃满全部名额——公司类分数再高也要给别的类留位置", () => {
    const pool = [
      ...many("company", 40, 100), // 公司类分数全场最高
      ...many("global", 5, 40),
      ...many("macro", 5, 30),
    ];
    const picked = selectEvents(pool, {
      min: 15,
      max: 25,
      perCategoryFloor: 2,
      perCategoryCap: 8,
    });
    const byCat = new Map<string, number>();
    for (const p of picked) byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1);
    expect(byCat.get("company")!).toBeLessThanOrEqual(8);
    expect(byCat.get("global")).toBeGreaterThanOrEqual(2);
    expect(byCat.get("macro")).toBeGreaterThanOrEqual(2);
  });

  it("池子不够时不硬凑——有几条给几条", () => {
    const picked = selectEvents(many("company", 4, 100), {
      min: 15,
      max: 25,
      perCategoryFloor: 2,
      perCategoryCap: 8,
    });
    expect(picked).toHaveLength(4);
  });
});

describe("coverageReport — 第 4 步「检查每个类别是否存在重大遗漏」", () => {
  it("池子有料却一条没选中 → 报 gap", () => {
    const pool = [
      { ...ev({ id: "g1", title: "海外" }), mergedCount: 1, sources: [], category: "global" as const, score: 10, reasons: {} },
      { ...ev({ id: "c1", title: "公司" }), mergedCount: 1, sources: [], category: "company" as const, score: 90, reasons: {} },
    ];
    const rep = coverageReport(pool, [pool[1]!], 1);
    const global = rep.find((r) => r.category === "global")!;
    expect(global).toMatchObject({ pool: 1, picked: 0, gap: true });
  });

  it("整类池子本来就是空的 → 不算遗漏（今天真没这类事）", () => {
    const pool = [
      { ...ev({ id: "c1", title: "公司" }), mergedCount: 1, sources: [], category: "company" as const, score: 90, reasons: {} },
    ];
    const rep = coverageReport(pool, pool, 1);
    expect(rep.find((r) => r.category === "global")).toMatchObject({
      pool: 0,
      gap: false,
    });
  });
});

// 以下三组全部来自 2026-07-30 真库 dry-run 暴露的问题，不是想象出来的边界。
describe("categorize — 摘要不能改判已绑公司的事件（真库踩坑）", () => {
  it("「宁德时代关联企业参设并购基金」摘要里有「私募」，但它是公司事件不是国内宏观", () => {
    expect(
      categorize(
        ev({
          id: "1",
          title: "宁德时代关联企业参设并购股权投资基金，出资额约30亿元",
          brief: "该合伙企业由厦门溥泉私募基金管理合伙企业（有限合伙）共同出资。",
          entityNames: ["宁德时代"],
          entityTypes: ["COMPANY"],
        }),
      ),
    ).toBe("company");
  });

  it("标题里就有宏观主体时仍归宏观（别把闸关死）", () => {
    expect(
      categorize(
        ev({
          id: "2",
          title: "央行开展2065亿元逆回购，宁德时代等蓝筹受益",
          entityNames: ["宁德时代"],
          entityTypes: ["COMPANY"],
        }),
      ),
    ).toBe("macro");
  });

  it("没绑公司的市场级条目仍可由摘要定层", () => {
    expect(
      categorize(
        ev({
          id: "3",
          title: "存储链午后走强",
          brief: "隔夜美股费城半导体指数大跌5.33%，美光跌9.94%。",
        }),
      ),
    ).toBe("global");
  });

  it("「上市首日开盘报971港元」是已发生的公司事件，不是日历", () => {
    expect(
      categorize(
        ev({
          id: "4",
          title: "中际旭创港股上市首日开盘报971港元",
          entityNames: ["中际旭创"],
          entityTypes: ["COMPANY"],
        }),
      ),
    ).toBe("company");
  });
});

describe("selectEvents — 同一件事的连续追更要靠主体上限收口", () => {
  const followUps = Array.from({ length: 6 }, (_, i) => ({
    ...ev({
      id: `f${i}`,
      // 措辞/角度/数字侧重全不同——标题相似度拦不住，只有主体一样
      title: [
        "兆易创新朱一明套现44亿元后 左手增持右手回购",
        "股价腰斩！套现44亿元后兆易创新董事长反手拟增持",
        "兆易创新掌门人抛增持计划 此前减持套现44亿",
        "套现44亿再砸超10亿回购！朱一明上演教科书级资本运作",
        "减持套现44亿元后 兆易创新实控人拟增持不低于10亿元",
        "兆易创新一个月回撤近60% 朱一明提议最高20亿元回购",
      ][i]!,
      entityNames: ["兆易创新"],
      entityIds: ["e-zyc"],
      entityTypes: ["COMPANY"],
    }),
    mergedCount: 1,
    sources: ["s"],
    category: "company" as const,
    score: 90 - i,
    reasons: {},
  }));
  const others = Array.from({ length: 6 }, (_, i) => ({
    ...ev({
      id: `o${i}`,
      title: `别家公司事件 ${i}`,
      entityNames: [`公司${i}`],
      entityIds: [`e${i}`],
      entityTypes: ["COMPANY"],
    }),
    mergedCount: 1,
    sources: ["s"],
    category: "company" as const,
    score: 50 - i,
    reasons: {},
  }));

  it("同主体最多 2 条，剩下的名额让给别的主体", () => {
    const picked = selectEvents([...followUps, ...others], {
      min: 8,
      max: 8,
      perCategoryFloor: 2,
      perCategoryCap: 8,
      perSubjectCap: 2,
    });
    const zyc = picked.filter((p) => p.entityNames[0] === "兆易创新");
    expect(zyc).toHaveLength(2);
    expect(picked.length).toBeGreaterThan(2);
  });

  it("不设上限时会被追更占满（证明这道闸真的在起作用）", () => {
    const picked = selectEvents([...followUps, ...others], {
      min: 6,
      max: 6,
      perCategoryFloor: 2,
      perCategoryCap: 8,
    });
    expect(picked.filter((p) => p.entityNames[0] === "兆易创新")).toHaveLength(6);
  });
});
