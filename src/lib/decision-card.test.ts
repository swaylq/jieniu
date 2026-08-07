import { describe, it, expect } from "vitest";
import {
  buildDecisionCard,
  money,
  OPERATING_DAYS,
  RECENT_DAYS,
  type CardEvent,
  type CardSignal,
  type DecisionInput,
} from "./decision-card";
import { scanCompliance } from "./compliance";
import type { UserDimension } from "./user-thesis";
import type { RadarBar } from "./radar/series";

const NOW = new Date("2026-08-06T12:00:00+08:00");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function dim(key: string, over: Partial<UserDimension> = {}): UserDimension {
  return {
    key,
    watch: `盯：${key}`,
    bull: "",
    bear: "",
    priority: false,
    sensitivity: "normal",
    muted: false,
    source: "base",
    ...over,
  };
}

function sig(over: Partial<CardSignal> = {}): CardSignal {
  return {
    dimensionKey: "订单与大客户",
    direction: "bull",
    materiality: 70,
    fact: "公司公告中标 3.2 亿元框架合同",
    grade: "direct",
    newsId: "n1",
    newsTitle: "中标公告",
    sourceName: "上交所",
    publishedAt: ago(3),
    ...over,
  };
}

function evt(over: Partial<CardEvent> = {}): CardEvent {
  return {
    eventType: "财报",
    title: "2026 年半年度报告",
    tier: "PRIMARY",
    newsId: "e1",
    publishedAt: ago(10),
    ...over,
  };
}

/** N 根日线，每天涨跌 `pct`%，主力净额 `net` 元。 */
function bars(n: number, pct: number, net: number | null = 1e7): RadarBar[] {
  return Array.from({ length: n }, (_, i) => ({
    day: `2026-0${1 + Math.floor(i / 28)}-${`${(i % 28) + 1}`.padStart(2, "0")}`,
    close: 10,
    changePct: pct,
    amount: 1e8,
    netAmount: net,
    netRatio: null,
    turnoverRate: null,
  }));
}

const base: DecisionInput = {
  now: NOW,
  dims: [],
  signals: [],
  alerts: [],
  events: [],
  consensus: null,
  bars: [],
  unlock: null,
  margin: null,
};

describe("buildDecisionCard · 结论枚举", () => {
  it("五个模型里三个没料 → 数据不足，且明说缺的是什么", () => {
    const c = buildDecisionCard(base);
    expect(c.verdict).toBe("insufficient");
    expect(c.verdictLabel).toBe("数据不足，无法判断");
    expect(c.body).toContain("宁可说不知道");
    // 「不知道」必须落到具体模型上，不能是一句笼统的「暂无数据」
    expect(c.headline).toMatch(/基本面|估值与预期|风险|趋势与资金/);
  });

  it("多个模型改善且无反方 → 逻辑明显增强", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("订单与大客户"), dim("公司治理")],
      signals: [
        sig(),
        sig({ newsId: "n2", fact: "二期产线投产，产能翻倍" }),
        sig({ dimensionKey: "公司治理", newsId: "n3", fact: "控股股东增持 1.2%" }),
      ],
      bars: bars(60, 0.5),
      consensus: null,
      events: [evt()],
    });
    expect(c.verdict).toBe("strengthen_strong");
    expect(c.tally).toContain("3 项改善");
  });

  it("一边改善一边走弱 → 冲突必须显式呈现，不许被平均掉", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("订单与大客户")],
      signals: [sig(), sig({ newsId: "n2", fact: "新增 2 亿元订单" })],
      bars: bars(60, -0.6, -2e7), // 价跌 + 资金净流出
      events: [
        evt({ eventType: "监管", newsId: "e2", title: "收到监管关注函" }),
        evt({ eventType: "减持", newsId: "e3", title: "股东减持计划" }),
        evt({ eventType: "问询", newsId: "e4", title: "年报问询函" }),
      ],
    });
    expect(c.verdict).toBe("conflict");
    expect(c.headline).toContain("矛盾");
    expect(c.models.some((m) => m.stance === "support")).toBe(true);
    expect(c.models.some((m) => m.stance === "against")).toBe(true);
  });

  it("只有反方读数 → 逻辑出现削弱", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("订单与大客户")],
      signals: [
        sig({ direction: "bear", fact: "大客户订单下滑 30%", newsId: "n9" }),
        sig({ direction: "bear", fact: "二期产线延期", newsId: "n8" }),
      ],
      bars: bars(60, 0.02, 1e5),
      consensus: {
        orgNum: 10,
        buy: 8,
        add: 2,
        neutral: 0,
        eps: [
          { year: "2025", eps: 2 },
          { year: "2026", eps: 2.4 },
        ],
        asOf: ago(1),
      },
    });
    expect(c.verdict).toBe("weaken");
  });

  it("顶档一手反面证据 + 基本面与风险同时走弱 → 核心逻辑可能被破坏（最重的一档能被触发）", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("订单与大客户")],
      signals: [
        sig({ direction: "bear", grade: "direct", materiality: 85, fact: "第一大客户终止合作", newsId: "b1" }),
        sig({ direction: "bear", grade: "direct", materiality: 85, fact: "在手订单同比减少 45%", newsId: "b2" }),
      ],
      events: [
        evt({ eventType: "监管", newsId: "e2", title: "收到监管关注函" }),
        evt({ eventType: "问询", newsId: "e3", title: "半年报问询函" }),
        evt({ eventType: "诉讼", newsId: "e4", title: "重大诉讼公告" }),
      ],
      bars: bars(60, -0.8, -3e7),
    });
    expect(c.verdict).toBe("broken");
  });
});

describe("buildDecisionCard · 五个模型互不重复", () => {
  it("经营族信号只进基本面，治理/外部族只进事件——同一条证据不许被数两遍", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("毛利率与成本"), dim("公司治理")],
      signals: [
        sig({ dimensionKey: "毛利率与成本", fact: "毛利率环比提升 2.1pp", newsId: "f1" }),
        sig({ dimensionKey: "公司治理", fact: "回购 1.44 亿元已实施完毕", newsId: "g1" }),
      ],
    });
    const fund = c.models.find((m) => m.key === "fundamental")!;
    const event = c.models.find((m) => m.key === "event")!;
    expect(fund.basis.map((b) => b.newsId)).toContain("f1");
    expect(fund.basis.map((b) => b.newsId)).not.toContain("g1");
    expect(event.basis.map((b) => b.newsId)).toContain("g1");
    expect(event.basis.map((b) => b.newsId)).not.toContain("f1");
  });

  it("同一维度的多条追更只留最强的一条（三条同一次回购不是三份证据）", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("现金流与资本开支")],
      signals: [
        sig({ dimensionKey: "现金流与资本开支", grade: "supporting", materiality: 60, fact: "回购金额较大", newsId: "r1" }),
        sig({ dimensionKey: "现金流与资本开支", grade: "direct", materiality: 70, fact: "累计回购 70.5 万股，支付 1.44 亿元", newsId: "r2" }),
        sig({ dimensionKey: "现金流与资本开支", grade: "supporting", materiality: 80, fact: "回购进展公告", newsId: "r3" }),
      ],
    });
    const fund = c.models.find((m) => m.key === "fundamental")!;
    expect(fund.basis.filter((b) => b.newsId?.startsWith("r"))).toHaveLength(1);
    // 同维度里 direct 档优先于材料度更高的旁证
    expect(fund.basis[0]!.newsId).toBe("r2");
  });
});

describe("buildDecisionCard · 各模型的判据", () => {
  it("估值模型不给「预期高增」投支持票——A股次年 EPS 预期中位数就有 +33%，没有鉴别力", () => {
    const c = buildDecisionCard({
      ...base,
      consensus: {
        orgNum: 16,
        buy: 11,
        add: 5,
        neutral: 0,
        eps: [
          { year: "2025", eps: 1.83 },
          { year: "2026", eps: 2.68 }, // +46%
        ],
        asOf: ago(0),
      },
    });
    const v = c.models.find((m) => m.key === "valuation")!;
    expect(v.stance).toBe("flat");
    expect(v.level).not.toContain("46");
    expect(v.basis.some((b) => b.text.includes("+46.4%"))).toBe(true);
    expect(v.missing).toContain("上修");
  });

  it("次年 EPS 预期下滑才投反对票（那是有信息量的 7%）", () => {
    const c = buildDecisionCard({
      ...base,
      consensus: {
        orgNum: 8,
        buy: 6,
        add: 2,
        neutral: 0,
        eps: [
          { year: "2025", eps: 2 },
          { year: "2026", eps: 1.6 },
        ],
        asOf: ago(0),
      },
    });
    const v = c.models.find((m) => m.key === "valuation")!;
    expect(v.stance).toBe("against");
    expect(v.level).toContain("下滑");
  });

  it("三分之一以上机构给中性/未披露 → 记为分歧（反方信息）", () => {
    const c = buildDecisionCard({
      ...base,
      consensus: {
        orgNum: 9,
        buy: 3,
        add: 2,
        neutral: 4,
        eps: [
          { year: "2025", eps: 1 },
          { year: "2026", eps: 1.5 },
        ],
        asOf: ago(0),
      },
    });
    const v = c.models.find((m) => m.key === "valuation")!;
    expect(v.stance).toBe("against");
    expect(v.level).toContain("分歧");
  });

  it("日线不足 25 根不给趋势方向（宁可留空）", () => {
    const c = buildDecisionCard({ ...base, bars: bars(20, 2) });
    const t = c.models.find((m) => m.key === "trend")!;
    expect(t.stance).toBe("unknown");
    expect(t.missing).toContain("20 根");
  });

  it("趋势用涨跌幅连乘造合成指数，不受除权缺口影响", () => {
    // close 全等于 10（除息后价格不连续的极端形状），但 changePct 一路为正
    const c = buildDecisionCard({ ...base, bars: bars(60, 0.8) });
    const t = c.models.find((m) => m.key === "trend")!;
    expect(t.stance).toBe("support");
    expect(t.level).toBe("正在强化");
  });

  it("风险模型只往下投票——「暂未发现风险」不等于利好", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("订单与大客户")],
      signals: [sig()],
      margin: { rzye: 1.5e10, zb: 6.2 },
    });
    const r = c.models.find((m) => m.key === "risk")!;
    expect(["flat", "against"]).toContain(r.stance);
    expect(r.stance).not.toBe("support");
  });

  it("解禁只在未来 90 天内才计入风险，比例大的加重", () => {
    const near = buildDecisionCard({
      ...base,
      unlock: { freeDate: "2026-09-01", ratio: 8, type: "首发原股东限售股" },
    });
    const far = buildDecisionCard({
      ...base,
      unlock: { freeDate: "2027-09-01", ratio: 8, type: "首发原股东限售股" },
    });
    expect(near.models.find((m) => m.key === "risk")!.stance).toBe("against");
    expect(far.models.find((m) => m.key === "risk")!.level).toBe("数据不足");
  });

  it("「最近一次业绩类披露」只认一手公告，不认被打上财报体裁的媒体综述", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("订单与大客户")],
      signals: [sig()],
      events: [
        evt({
          eventType: "财报",
          tier: "MEDIA",
          title: "月内超600家A股上市公司获机构调研",
          newsId: "m1",
        }),
      ],
    });
    const fund = c.models.find((m) => m.key === "fundamental")!;
    expect(fund.basis.some((b) => b.text.includes("获机构调研"))).toBe(false);
  });

  it("大宗交易/龙虎榜不进「现在发生了什么」——那是撮合记录不是公司事件", () => {
    const c = buildDecisionCard({
      ...base,
      events: [
        evt({ eventType: "大宗交易", title: "大宗交易：1笔共608万元", newsId: "d1" }),
        evt({ eventType: "分红", title: "2026年中期分红实施公告", newsId: "d2" }),
      ],
    });
    const e = c.models.find((m) => m.key === "event")!;
    expect(e.basis.some((b) => b.text.includes("大宗交易：1笔"))).toBe(false);
    expect(e.basis.some((b) => b.text.includes("中期分红"))).toBe(true);
  });
});

describe("buildDecisionCard · 条件完成度", () => {
  it("条件全部来自用户自设的维度与价位，解牛一条都不添", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("A"), dim("B"), dim("C", { muted: true })],
      alerts: [{ active: true, triggeredAt: null, label: "跌到 24 元" }],
      signals: [sig({ dimensionKey: "A", fact: "A 命题被公告验证" })],
    });
    // 静音的维度不算条件；两个活跃维度 + 一个价格观察位 = 3
    expect(c.conditions.total).toBe(3);
    expect(c.conditions.met).toBe(1);
    expect(c.conditions.items.map((i) => i.label)).not.toContain("盯：C");
  });

  it("同一维度上既有兑现又有恶化时，先给用户看反面那条", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("A")],
      signals: [
        sig({ dimensionKey: "A", direction: "bull", fact: "利好", newsId: "p1" }),
        sig({ dimensionKey: "A", direction: "bear", fact: "利空", newsId: "p2" }),
      ],
    });
    expect(c.conditions.items[0]!.state).toBe("adverse");
    expect(c.conditions.items[0]!.newsId).toBe("p2");
    expect(c.conditions.met).toBe(0);
  });

  it("材料度低于该维度敏感度门槛的不算满足", () => {
    const low = buildDecisionCard({
      ...base,
      dims: [dim("A", { sensitivity: "low" })], // 门槛 80
      signals: [sig({ dimensionKey: "A", materiality: 70 })],
    });
    const high = buildDecisionCard({
      ...base,
      dims: [dim("A", { sensitivity: "high" })], // 门槛 40
      signals: [sig({ dimensionKey: "A", materiality: 70 })],
    });
    expect(low.conditions.met).toBe(0);
    expect(high.conditions.met).toBe(1);
  });

  it("近 7 天新满足的条数单独报出来（回答「比上次多了几项」）", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("A"), dim("B")],
      signals: [
        sig({ dimensionKey: "A", publishedAt: ago(2), newsId: "s1" }),
        sig({ dimensionKey: "B", publishedAt: ago(40), newsId: "s2" }),
      ],
    });
    expect(c.conditions.met).toBe(2);
    expect(c.conditions.freshlyMet).toBe(1);
  });

  it("没写逻辑时条件块是 unset，而不是渲染成 0/0", () => {
    const c = buildDecisionCard({ ...base, bars: bars(60, 0.5) });
    expect(c.conditions.unset).toBe(true);
    expect(c.conditions.total).toBe(0);
    expect(c.body).toContain("写下");
  });

  it("触发超过 7 天的旧提醒不占条目", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("A")],
      alerts: [{ active: false, triggeredAt: ago(30), label: "跌到 24 元" }],
    });
    expect(c.conditions.total).toBe(1); // 只剩那个维度
  });
});

describe("buildDecisionCard · 窗口与序列化", () => {
  it("超出 30 天窗口的信号不进事件模型，但仍在基本面的 90 天窗口内", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("订单与大客户"), dim("公司治理")],
      signals: [
        sig({ dimensionKey: "公司治理", publishedAt: ago(RECENT_DAYS + 5), newsId: "o1" }),
        sig({ publishedAt: ago(RECENT_DAYS + 5), newsId: "o2" }),
      ],
    });
    expect(c.models.find((m) => m.key === "event")!.basis).toHaveLength(0);
    expect(c.models.find((m) => m.key === "fundamental")!.basis.length).toBeGreaterThan(0);
  });

  it("超出 90 天的信号哪个模型都不进", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("订单与大客户")],
      signals: [sig({ publishedAt: ago(OPERATING_DAYS + 5) })],
    });
    expect(c.models.find((m) => m.key === "fundamental")!.stance).toBe("unknown");
  });

  it("字符串时间戳与 Date 等价（tRPC 序列化后是字符串）", () => {
    const a = buildDecisionCard({ ...base, dims: [dim("订单与大客户")], signals: [sig()] });
    const b = buildDecisionCard({
      ...base,
      dims: [dim("订单与大客户")],
      signals: [sig({ publishedAt: ago(3).toISOString() })],
    });
    expect(b.verdict).toBe(a.verdict);
    expect(b.tally).toBe(a.tally);
  });

  it("money 把元换算成人读得懂的量级", () => {
    expect(money(1.7923e9)).toBe("17.92 亿元");
    expect(money(6.08e6)).toBe("608 万元");
  });
});

describe("buildDecisionCard · 一致性与合规", () => {
  it("一致性只数有方向的模型，并且明说它不是概率", () => {
    const c = buildDecisionCard({
      ...base,
      dims: [dim("订单与大客户")],
      signals: [sig(), sig({ newsId: "n2" })],
      bars: bars(60, 0.5),
    });
    expect(c.agreement.total).toBe(5);
    expect(c.agreement.note).toContain("指向同一侧");
    expect(c.agreement.same).toBeLessThanOrEqual(5);
  });

  it("没有任何模型给方向时如实说「没有模型给出方向」", () => {
    expect(buildDecisionCard(base).agreement.note).toBe("没有模型给出方向");
  });

  it("任何输出文本都不含操作暗示或涨跌预测（合规铁律②的机械判据）", () => {
    const cases = [
      buildDecisionCard(base),
      buildDecisionCard({ ...base, dims: [dim("A")], signals: [sig({ dimensionKey: "A" })] }),
      buildDecisionCard({ ...base, bars: bars(60, 0.8) }),
      buildDecisionCard({ ...base, bars: bars(60, -0.8, -3e7) }),
      buildDecisionCard({
        ...base,
        dims: [dim("A")],
        signals: [sig({ dimensionKey: "A", direction: "bear" })],
        events: [evt({ eventType: "监管", newsId: "e9" }), evt({ eventType: "减持", newsId: "e8" })],
        unlock: { freeDate: "2026-09-01", ratio: 8, type: "首发" },
      }),
      buildDecisionCard({
        ...base,
        consensus: { orgNum: 5, buy: 5, add: 0, neutral: 0, eps: [{ year: "2025", eps: 1 }, { year: "2026", eps: 0.5 }], asOf: ago(1) },
      }),
    ];
    /**
     * 刻意**不**拦「买入 / 增持 / 减持」这三个词：它们在这张卡里是**第三方事实的转述**
     * ——「评级分布 买入 11 / 增持 5」是东财给的机构评级口径，「减持 2」是公告体裁名。
     * 拦掉它们等于不许如实转述别人说了什么（`lib/compliance.ts` 里同一个理由：
     * 红线是「建议/推荐 + 买入」这种句式，不是这两个字本身）。
     * 所以这里分两层：项目自己的 `scanCompliance` 判句式，词表只判**解牛自己**
     * 永远不该说出口的词。
     */
    const banned = [
      "卖出", "加仓", "减仓", "建仓", "清仓", "抄底", "逃顶",
      "目标价", "看涨", "看跌", "必涨", "必跌", "值得关注", "可以关注",
      "突破", "支撑位", "压力位", "金叉", "死叉", "低估", "高估",
    ];
    for (const c of cases) {
      const text = [
        c.headline,
        c.tally,
        c.body,
        c.verdictLabel,
        c.agreement.note,
        c.topUncertainty ?? "",
        ...c.models.flatMap((m) => [m.name, m.level, m.missing ?? "", m.asOf ?? "", ...m.basis.map((b) => b.text)]),
        ...c.conditions.items.flatMap((i) => [i.label, i.detail]),
      ].join("｜");
      for (const w of banned) expect(text, `命中禁用词「${w}」：${text}`).not.toContain(w);
      expect(scanCompliance(text), `合规扫描命中：${text}`).toEqual([]);
    }
  });
});
