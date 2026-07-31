import { describe, it, expect } from "vitest";
import { gradeCatalyst, pickCatalysts, type CatalystNews } from "./catalyst";

function news(p: Partial<CatalystNews>): CatalystNews {
  return {
    id: "n1",
    title: "某公司公告",
    sourceName: "东方财富·公告",
    tier: "PRIMARY",
    url: "https://x/1",
    publishedAt: new Date("2026-07-30T02:00:00Z"),
    importance: 60,
    eventType: null,
    boundCount: 2,
    ...p,
  };
}

describe("gradeCatalyst（§6 催化等级）", () => {
  it("公司公告 / 财报 / 业绩预告 → 高", () => {
    expect(gradeCatalyst(news({ title: "关于2026年半年度业绩预告的公告" }))).toBe("HIGH");
    expect(gradeCatalyst(news({ title: "2026年半年度报告" }))).toBe("HIGH");
  });

  it("订单 / 中标 / 涨价 / 招投标 → 高（是硬事实，不是观点）", () => {
    const t = { sourceName: "集微网", tier: "MEDIA" };
    expect(gradeCatalyst(news({ ...t, title: "公司中标12亿元储能项目" }))).toBe("HIGH");
    expect(gradeCatalyst(news({ ...t, title: "存储芯片本月再度提价20%" }))).toBe("HIGH");
  });

  it("行业销量 / 出货量这类行业数据 → 中（不是这家公司自己的合同）", () => {
    expect(
      gradeCatalyst(
        news({ sourceName: "乘联会", tier: "MEDIA", title: "7月新能源车销量同比增长32%" }),
      ),
    ).toBe("MEDIUM");
  });

  it("管理层口径（投资者关系活动记录表）→ 中，不因为走公告渠道就升到高", () => {
    expect(
      gradeCatalyst(news({ title: "投资者关系活动记录表", sourceName: "东方财富·公告" })),
    ).toBe("MEDIUM");
  });

  it("券商研报 / 市场传闻 → 低", () => {
    expect(
      gradeCatalyst(news({ title: "维持买入评级，目标价45元", sourceName: "东方财富·券商研报", tier: "MEDIA" })),
    ).toBe("LOW");
    expect(
      gradeCatalyst(news({ title: "据传公司将获大额订单", sourceName: "某站", tier: "MEDIA" })),
    ).toBe("LOW");
  });
});

describe("pickCatalysts（选证据）", () => {
  const base = [
    news({ id: "a", title: "关于签订12亿元供货合同的公告" }),
    news({ id: "b", title: "维持买入评级", sourceName: "东方财富·券商研报", tier: "MEDIA" }),
    news({ id: "c", title: "2026年半年度业绩预告", publishedAt: new Date("2026-07-29T02:00:00Z") }),
  ];

  it("按等级排序，高的在前", () => {
    const r = pickCatalysts(base, 3);
    expect(r.grade).toBe("HIGH");
    expect(r.items[0]!.grade).toBe("HIGH");
    expect(r.items[r.items.length - 1]!.grade).toBe("LOW");
  });

  it("整体等级取最高的那条——一条硬公告就够支撑「有催化」", () => {
    expect(pickCatalysts([base[1]!], 3).grade).toBe("LOW");
    expect(pickCatalysts([base[1]!, base[0]!], 3).grade).toBe("HIGH");
  });

  it("没有任何资讯 → NONE，且明说「暂无明确催化」", () => {
    const r = pickCatalysts([], 3);
    expect(r.grade).toBe("NONE");
    expect(r.items).toEqual([]);
    expect(r.emptyNote).toContain("暂无明确催化");
  });

  it("绑定扇出大的综述稿不算个股催化（pull 宽 push 严的同一把尺子）", () => {
    const roundup = news({ id: "r", title: "今日十大牛股全解析", boundCount: 9 });
    expect(pickCatalysts([roundup], 3).grade).toBe("NONE");
  });

  it("同一天同一来源的重复标题只留一条", () => {
    const dup = [
      news({ id: "x", title: "关于回购公司股份的进展公告" }),
      news({ id: "y", title: "关于回购公司股份的进展公告" }),
    ];
    expect(pickCatalysts(dup, 3).items).toHaveLength(1);
  });

  it("超过上限只留前 N 条", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      news({ id: `m${i}`, title: `关于签订${i}亿元合同的公告` }),
    );
    expect(pickCatalysts(many, 3).items).toHaveLength(3);
  });
});

describe("gradeCatalyst — 体裁白名单（§2-3「业绩、订单、产品、价格、政策、回购、增持等」）", () => {
  it("大宗交易 / 龙虎榜 / 融资融券 是交易结构事件，不是催化", () => {
    expect(
      gradeCatalyst(
        news({ title: "德明利大宗交易：2笔共3510万元，均溢价0%", sourceName: "东方财富·大宗交易" }),
      ),
    ).toBe("NONE");
    expect(
      gradeCatalyst(news({ title: "某某登龙虎榜：机构净买入1.2亿", sourceName: "东方财富·龙虎榜" })),
    ).toBe("NONE");
  });

  it("限制性股票归属 / 募集资金专户 / 中介核查这类程序性公告不是催化", () => {
    expect(
      gradeCatalyst(news({ title: "关于2023年限制性股票激励计划首次授予部分第二个归属期归属条件成就的公告" })),
    ).toBe("NONE");
    expect(gradeCatalyst(news({ title: "关于开立募集资金专项账户并签订监管协议的公告" }))).toBe("NONE");
  });

  it("需求点名的七类照常入选", () => {
    const t = (title: string) => gradeCatalyst(news({ title }));
    expect(t("2026年半年度业绩预告")).toBe("HIGH");
    expect(t("关于签订12亿元供货合同的公告")).toBe("HIGH");
    expect(t("关于回购公司股份的进展公告")).toBe("HIGH");
    expect(t("关于控股股东增持公司股份的公告")).toBe("HIGH");
    expect(t("关于新一代产品量产的公告")).toBe("HIGH");
  });

  it("主体对不上的资讯不算这家公司的催化（标题里「别人家：」开头）", () => {
    const n = news({ title: "城地香江：全资子公司联合体成为中国移动宁夏数据中心中标人" });
    expect(gradeCatalyst(n, "中国移动(600941)")).toBe("NONE");
    expect(gradeCatalyst(n, "城地香江(603887)")).toBe("HIGH");
  });

  it("没有「公司名：」前缀时不做主体判定，不误杀", () => {
    expect(gradeCatalyst(news({ title: "关于签订12亿元供货合同的公告" }), "某公司(000001)")).toBe("HIGH");
  });
});

describe("gradeCatalyst — 媒体稿不能凭一个行业词升到「高」", () => {
  const media = {
    id: "m",
    sourceName: "华尔街见闻·A股",
    tier: "MEDIA",
    url: "u",
    publishedAt: new Date("2026-07-30T02:00:00Z"),
    importance: 60,
    eventType: null,
    boundCount: 3,
  };

  it("标题里根本没提这家公司的媒体稿，封顶到「中」", () => {
    const n = { ...media, title: "多家企业订单已翻番｜活力中国调研行" };
    expect(gradeCatalyst(n, "沃尔核材(002130)")).toBe("MEDIUM");
  });

  it("标题点名了这家公司的媒体稿，照常按硬度判", () => {
    const n = { ...media, title: "沃尔核材新签12亿元订单" };
    expect(gradeCatalyst(n, "沃尔核材(002130)")).toBe("HIGH");
  });

  it("一手公告不受这条影响（公告的主体本来就由信源给定）", () => {
    const n = { ...media, sourceName: "东方财富·公告", tier: "PRIMARY", title: "关于签订重大合同的公告" };
    expect(gradeCatalyst(n, "沃尔核材(002130)")).toBe("HIGH");
  });
});
