import { describe, it, expect } from "vitest";
import {
  buildAlertEvents,
  selectForDelivery,
  withinQuietHours,
  isPushWorthyNews,
  DELIVERY_MAX_ITEMS,
  PRIORITY,
  type CrossingInput,
  type NewsInput,
  type PriceInput,
  type AlertEventDraft,
} from "./alert-outbox";
import { defaultAlertPrefs } from "./alert-protocol";

const crossing = (o: Partial<CrossingInput> = {}): CrossingInput => ({
  entityId: "e1",
  entityName: "澜起科技",
  dimensionKey: "现金流与资本开支",
  fromState: "neutral",
  toState: "bearish",
  note: "资本开支指引大幅上调",
  newsId: "n9",
  newsTitle: "澜起科技:关于调整2026年资本开支计划的公告",
  crossedAt: new Date("2026-07-28T02:00:00Z"),
  muted: false,
  priority: false,
  dismissed: false,
  materiality: 75,
  threshold: 60,
  ...o,
});

const news = (o: Partial<NewsInput> & { id: string }): NewsInput => ({
  title: "兆易创新:2026年半年度业绩预告",
  brief: "上半年净利同比预增 120%–150%。",
  summary: null,
  entityId: "e2",
  entityName: "兆易创新",
  sourceName: "巨潮资讯",
  publishedAt: new Date("2026-07-28T01:00:00Z"),
  tier: "PRIMARY",
  importance: 70,
  boundCount: 2,
  ...o,
});

const price = (o: Partial<PriceInput> & { id: string }): PriceInput => ({
  entityId: "e3",
  entityName: "贵州茅台",
  direction: "below",
  threshold: 1400,
  triggeredPrice: 1398.5,
  triggeredAt: new Date("2026-07-28T05:30:00Z"),
  ...o,
});

const empty = { crossings: [], news: [], priceAlerts: [], prefs: defaultAlertPrefs() };

describe("buildAlertEvents — dedupeKey 只认事实，不认查询时刻", () => {
  it("同一次跨越重复生成得到同一个 dedupeKey", () => {
    const a = buildAlertEvents({ ...empty, crossings: [crossing()] })[0]!;
    const b = buildAlertEvents({ ...empty, crossings: [crossing()] })[0]!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).toContain("2026-07-28T02:00:00.000Z");
  });

  it("同维度更晚的新跨越是另一条事件（不会被旧的挡住）", () => {
    const [old] = buildAlertEvents({ ...empty, crossings: [crossing()] });
    const [fresh] = buildAlertEvents({
      ...empty,
      crossings: [crossing({ crossedAt: new Date("2026-07-29T02:00:00Z") })],
    });
    expect(old!.dedupeKey).not.toBe(fresh!.dedupeKey);
  });

  it("资讯 / 到价用各自的主键去重", () => {
    const [n] = buildAlertEvents({ ...empty, news: [news({ id: "n1" })] });
    const [p] = buildAlertEvents({ ...empty, priceAlerts: [price({ id: "p1" })] });
    expect(n!.dedupeKey).toBe("news:n1");
    expect(p!.dedupeKey).toBe("price:p1");
  });
});

describe("buildAlertEvents — occurredAt 取事实发生时刻", () => {
  it("跨越取 crossedAt、资讯取 publishedAt、到价取 triggeredAt", () => {
    const out = buildAlertEvents({
      ...empty,
      crossings: [crossing()],
      news: [news({ id: "n1" })],
      priceAlerts: [price({ id: "p1" })],
    });
    const byKind = new Map(out.map((e) => [e.kind, e]));
    expect(byKind.get("logic")!.occurredAt.toISOString()).toBe("2026-07-28T02:00:00.000Z");
    expect(byKind.get("fundamental")!.occurredAt.toISOString()).toBe("2026-07-28T01:00:00.000Z");
    expect(byKind.get("price")!.occurredAt.toISOString()).toBe("2026-07-28T05:30:00.000Z");
  });
});

describe("buildAlertEvents — 五道闸之一二：分类开关与维度静音", () => {
  it("关掉逻辑变化 → 不生成跨越事件", () => {
    const prefs = { ...defaultAlertPrefs(), logic: false };
    expect(buildAlertEvents({ ...empty, prefs, crossings: [crossing()] })).toHaveLength(0);
  });

  it("关掉重磅资讯 / 价格提醒 → 各自不生成", () => {
    expect(
      buildAlertEvents({
        ...empty,
        prefs: { ...defaultAlertPrefs(), fundamental: false },
        news: [news({ id: "n1" })],
      }),
    ).toHaveLength(0);
    expect(
      buildAlertEvents({
        ...empty,
        prefs: { ...defaultAlertPrefs(), price: false },
        priceAlerts: [price({ id: "p1" })],
      }),
    ).toHaveLength(0);
  });

  it("用户静音的维度不生成事件——连站内都不进", () => {
    expect(
      buildAlertEvents({ ...empty, crossings: [crossing({ muted: true })] }),
    ).toHaveLength(0);
  });
});

describe("buildAlertEvents — 敏感度闸（用户为每个维度自设的材料度下限）", () => {
  it("材料度低于该维度阈值 → 不提醒", () => {
    expect(
      buildAlertEvents({ ...empty, crossings: [crossing({ materiality: 45, threshold: 60 })] }),
    ).toHaveLength(0);
  });

  it("调高敏感度（阈值降到 40）后，同一条变化就会提醒", () => {
    expect(
      buildAlertEvents({ ...empty, crossings: [crossing({ materiality: 45, threshold: 40 })] }),
    ).toHaveLength(1);
  });

  it("调低敏感度（阈值升到 80）后，中等变化被滤掉", () => {
    expect(
      buildAlertEvents({ ...empty, crossings: [crossing({ materiality: 75, threshold: 80 })] }),
    ).toHaveLength(0);
  });

  it("材料度取不到时放行——数据缺失不等于不重要", () => {
    expect(
      buildAlertEvents({ ...empty, crossings: [crossing({ materiality: null, threshold: 80 })] }),
    ).toHaveLength(1);
  });
});

describe("buildAlertEvents — 第三道闸：复核负反馈", () => {
  it("上次复核判「不相关」的维度：仍进站内，但不投站外", () => {
    const [e] = buildAlertEvents({ ...empty, crossings: [crossing({ dismissed: true })] });
    expect(e).toBeDefined();
    expect(e!.offsite).toBe(false);
  });

  it("没被判过不相关的维度可以投站外", () => {
    const [e] = buildAlertEvents({ ...empty, crossings: [crossing()] });
    expect(e!.offsite).toBe(true);
  });
});

describe("buildAlertEvents — 优先级与文案", () => {
  it("重点维度 > 普通逻辑异动 > 到价 > 重磅资讯", () => {
    const out = buildAlertEvents({
      ...empty,
      crossings: [crossing({ priority: true }), crossing({ entityId: "e9", dimensionKey: "毛利率" })],
      news: [news({ id: "n1" })],
      priceAlerts: [price({ id: "p1" })],
    });
    expect(out.map((e) => e.priority)).toEqual([
      PRIORITY.logicPriority,
      PRIORITY.logic,
      PRIORITY.price,
      PRIORITY.fundamental,
    ]);
  });

  it("逻辑异动带公司名 + 维度 + 方向，正文含 hedged 理由和触发依据", () => {
    const [e] = buildAlertEvents({ ...empty, crossings: [crossing()] });
    expect(e!.title).toContain("澜起科技");
    expect(e!.title).toContain("现金流与资本开支");
    expect(e!.title).toContain("偏风险");
    expect(e!.body).toContain("证伪条件");
    expect(e!.body).toContain("澜起科技:关于调整2026年资本开支计划的公告");
    expect(e!.url).toBe("/entity/e1");
  });

  it("到价提醒用中性文案并注明非荐买卖", () => {
    const [e] = buildAlertEvents({ ...empty, priceAlerts: [price({ id: "p1" })] });
    expect(e!.title).toContain("跌破");
    expect(e!.body).toContain("非荐买卖");
  });

  it("资讯正文优先用 brief，缺则回退 summary", () => {
    const [a] = buildAlertEvents({ ...empty, news: [news({ id: "n1" })] });
    expect(a!.body).toContain("净利同比预增");
    const [b] = buildAlertEvents({
      ...empty,
      news: [news({ id: "n2", brief: null, summary: "摘要兜底" })],
    });
    expect(b!.body).toBe("摘要兜底");
    expect(a!.url).toBe("/news/n1");
  });

  it("同优先级内按事实发生时刻倒序", () => {
    const out = buildAlertEvents({
      ...empty,
      news: [
        news({ id: "old", entityId: "eA", publishedAt: new Date("2026-07-27T01:00:00Z") }),
        news({ id: "new", entityId: "eB", publishedAt: new Date("2026-07-28T09:00:00Z") }),
      ],
    });
    expect(out.map((e) => e.dedupeKey)).toEqual(["news:new", "news:old"]);
  });
});

// 「让 ai 在推送前拦一刀」：推送门槛必须**高于**站内浏览门槛。
// 站内 importance≥55 就能看到；能主动打扰人的必须是一手公告或足够重磅，且真的关于某一家公司。
describe("isPushWorthyNews — 推送门槛高于浏览门槛", () => {
  const n = (o: Partial<Parameters<typeof isPushWorthyNews>[0]> = {}) =>
    isPushWorthyNews({
      title: "东山精密:关于首次回购公司股份的公告",
      tier: "PRIMARY",
      importance: 70,
      boundCount: 2,
      entityName: "东山精密",
      ...o,
    });

  it("一手公告放行——解牛的定位就是一手", () => {
    expect(n({ tier: "PRIMARY", importance: 55 })).toBe(true);
  });

  it("媒体稿要够重磅才放行（55 分的媒体快讯只留站内）", () => {
    expect(n({ tier: "MEDIA", importance: 55 })).toBe(false);
    expect(n({ tier: "MEDIA", importance: 70 })).toBe(true);
  });

  // 2026-08-02 复盘的实测漏网：这条绑 2 家、75 分、一个综述词都不含，被推给了张楚寒。
  // 词表永远有洞，所以推送侧改用结构判据：媒体稿必须点名这家公司。
  it("媒体稿不点名这家公司就不推——市场级综述天然不点名", () => {
    expect(
      n({
        title: 'A股，小“奇迹日”！韩国，紧急道歉',
        tier: "MEDIA",
        importance: 75,
        boundCount: 2,
        entityName: "长鑫科技",
      }),
    ).toBe(false);
    expect(
      n({
        title: "长鑫科技上市首日大涨，存储周期成焦点",
        tier: "MEDIA",
        importance: 75,
        boundCount: 2,
        entityName: "长鑫科技",
      }),
    ).toBe(true);
  });

  it("实体名带代码后缀时先剥再比（大普微-UW(301666)）", () => {
    expect(
      n({
        title: "大普微披露半年报，营收同比增长",
        tier: "MEDIA",
        importance: 75,
        boundCount: 2,
        entityName: "大普微-UW(301666)",
      }),
    ).toBe(true);
  });

  it("一手公告不受点名判据约束——主体由源权威给出", () => {
    expect(
      n({ title: "关于首次回购公司股份的公告", tier: "PRIMARY", importance: 55, entityName: "东山精密" }),
    ).toBe(true);
  });

  it("绑定 3 家以上公司的一律不推——这种「顺带罗列」的必是综述", () => {
    // 实测噪音：华尔街见闻早餐(绑7)、月内超600家获调研(绑5)、二季度券商股获增持(绑3)
    expect(n({ title: "华尔街见闻早餐 | 2026年7月27日", tier: "MEDIA", importance: 75, boundCount: 7 })).toBe(false);
    expect(n({ title: "月内超600家A股上市公司获机构调研", tier: "MEDIA", importance: 70, boundCount: 5 })).toBe(false);
    expect(n({ boundCount: 3 })).toBe(false);
  });

  it("一家公司的 COMPANY+STOCK 两个实体（绑 2）是正常的，不算综述", () => {
    expect(n({ boundCount: 2 })).toBe(true);
    expect(n({ boundCount: 1 })).toBe(true);
  });

  it("复用既有综述判别器兜底（收评 / 龙虎榜 / 涨停潮…）", () => {
    expect(n({ title: "A股收评：三大指数集体走强", boundCount: 1 })).toBe(false);
    expect(n({ title: "沪指涨停潮再现 附股名单", boundCount: 2 })).toBe(false);
  });
});

describe("buildAlertEvents — 推送前的资讯过滤与同公司折叠", () => {
  it("不够格推送的资讯不生成事件", () => {
    const out = buildAlertEvents({
      ...empty,
      news: [
        news({ id: "noise", title: "从大额注销式回购看上市公司股东回报体系变革", tier: "MEDIA", importance: 55, boundCount: 1 }),
        news({ id: "real", entityId: "eZ" }),
      ],
    });
    expect(out.map((e) => e.dedupeKey)).toEqual(["news:real"]);
  });

  it("同一家公司一轮只推一条——跨源重复（公告 + 快讯）不该响两次", () => {
    // 实测：「东山精密:关于首次回购公司股份的公告」与「东山精密：首次回购公司股份11.5万股」是同一事实
    const out = buildAlertEvents({
      ...empty,
      news: [
        news({ id: "ann", entityId: "dsjm", title: "东山精密:关于首次回购公司股份的公告", tier: "PRIMARY", importance: 70 }),
        news({ id: "flash", entityId: "dsjm", title: "东山精密：首次回购公司股份11.5万股", tier: "PRIMARY", importance: 70 }),
      ],
    });
    expect(out).toHaveLength(1);
  });

  it("不同公司互不影响", () => {
    const out = buildAlertEvents({
      ...empty,
      news: [
        news({ id: "a", entityId: "c1" }),
        news({ id: "b", entityId: "c2" }),
      ],
    });
    expect(out).toHaveLength(2);
  });

  it("折叠不误伤逻辑异动与到价——它们各有自己的去重维度", () => {
    const out = buildAlertEvents({
      ...empty,
      crossings: [
        crossing({ dimensionKey: "现金流与资本开支" }),
        crossing({ dimensionKey: "毛利率" }),
      ],
    });
    expect(out).toHaveLength(2);
  });
});

describe("selectForDelivery — 第四道闸：条数上限，且不静默截断", () => {
  const draft = (i: number, o: Partial<AlertEventDraft> = {}): AlertEventDraft => ({
    kind: "fundamental",
    dedupeKey: `news:${i}`,
    entityId: "e1",
    title: `第 ${i} 条`,
    body: "",
    url: null,
    payload: {},
    occurredAt: new Date(2026, 6, 28, 10, i),
    priority: PRIORITY.fundamental,
    offsite: true,
    ...o,
  });

  it("超出上限的条目算进 heldBack，而不是丢掉", () => {
    const events = Array.from({ length: 9 }, (_, i) => draft(i));
    const { deliver, heldBack } = selectForDelivery(events);
    expect(deliver).toHaveLength(DELIVERY_MAX_ITEMS);
    expect(heldBack).toBe(9 - DELIVERY_MAX_ITEMS);
  });

  it("offsite=false 的不投站外，也不计入 heldBack（它本就只属于站内）", () => {
    const { deliver, heldBack } = selectForDelivery([
      draft(1, { offsite: false }),
      draft(2),
    ]);
    expect(deliver.map((d) => d.dedupeKey)).toEqual(["news:2"]);
    expect(heldBack).toBe(0);
  });

  it("先投高优先级，低优先级被挤下去", () => {
    const events = [
      ...Array.from({ length: DELIVERY_MAX_ITEMS }, (_, i) => draft(i)),
      draft(99, { priority: PRIORITY.logicPriority, dedupeKey: "logic:x" }),
    ];
    const { deliver } = selectForDelivery(events);
    expect(deliver[0]!.dedupeKey).toBe("logic:x");
    expect(deliver).toHaveLength(DELIVERY_MAX_ITEMS);
  });

  it("没有可投的返回空，调用方据此不发空信", () => {
    expect(selectForDelivery([]).deliver).toHaveLength(0);
    expect(selectForDelivery([draft(1, { offsite: false })]).deliver).toHaveLength(0);
  });
});

describe("withinQuietHours — 第五道闸：免打扰时段（本地时区）", () => {
  it("22:00–07:30 之间为静默", () => {
    expect(withinQuietHours(new Date(2026, 6, 28, 22, 0))).toBe(true);
    expect(withinQuietHours(new Date(2026, 6, 28, 23, 30))).toBe(true);
    expect(withinQuietHours(new Date(2026, 6, 29, 3, 0))).toBe(true);
    expect(withinQuietHours(new Date(2026, 6, 29, 7, 29))).toBe(true);
  });

  it("07:30–22:00 之间可投递", () => {
    expect(withinQuietHours(new Date(2026, 6, 29, 7, 30))).toBe(false);
    expect(withinQuietHours(new Date(2026, 6, 29, 15, 30))).toBe(false);
    expect(withinQuietHours(new Date(2026, 6, 29, 21, 59))).toBe(false);
  });
});
