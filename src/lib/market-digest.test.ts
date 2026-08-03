import { describe, it, expect } from "vitest";
import {
  parseDigestResponse,
  buildDigestPrompt,
  digestInputHash,
  tradeDateOf,
  hasForbiddenAdvice,
  isTwoSided,
  cleanEntityName,
  isDigestWorthyFiling,
  normalizeScope,
  type DigestInputs,
} from "./market-digest";

const inputs: DigestInputs = {
  tradeDate: "2026-07-28",
  market: "CN",
  session: "close",
  indices: [
    { label: "上证指数", price: 3421.5, changePct: 0.62 },
    { label: "创业板指", price: 2210.3, changePct: -1.15 },
  ],
  breadth: {
    counted: 5316, up: 900, down: 4300, flat: 116,
    limitUp: 12, limitDown: 48, medianChangePct: -1.62,
  },
  // 六步管线选出的事件（2026-07-30 起取代原来的三层 macro + 十条重磅资讯）
  events: [
    { category: "global", title: "韩国首尔综指大跌8%，接近触发熔断", brief: "", source: "东方财富·快讯", primary: false, sources: 2, subjects: [] },
    { category: "macro", title: "央行今日开展2065亿元7天期逆回购操作", brief: "利率1.40%", source: "华尔街见闻·A股", primary: false, sources: 1, subjects: [] },
    { category: "industry", title: "机构：第二季度智能手机内存价格环比增长超80%", brief: "", source: "东方财富·快讯", primary: false, sources: 1, subjects: [] },
    { category: "company", title: "东山精密:关于首次回购公司股份的公告", brief: "首次回购1150万元", source: "东方财富·公告", primary: true, sources: 1, subjects: ["东山精密"] },
    { category: "flow", title: "北向资金今日净买入80.3亿元", brief: "", source: "财联社", primary: false, sources: 1, subjects: [] },
  ],
  coverage: [
    { category: "global", label: "全球市场", pool: 12, picked: 1, gap: false },
    { category: "macro", label: "国内宏观", pool: 9, picked: 1, gap: false },
    { category: "industry", label: "行业", pool: 20, picked: 1, gap: false },
    { category: "company", label: "公司", pool: 40, picked: 1, gap: false },
    { category: "flow", label: "资金", pool: 6, picked: 1, gap: false },
    { category: "calendar", label: "日历", pool: 0, picked: 0, gap: false },
  ],
  sectors: {
    strong: [{ name: "半导体", avgChangePct: 2.4, signal: "共振", leaders: ["兆易创新", "北方华创"], facts: ["兆易创新:半年度业绩预告"] }],
    weak: [{ name: "白酒", avgChangePct: -1.8, signal: "共跌", leaders: ["贵州茅台"], facts: [] }],
  },
  stocks: [
    { name: "宁德时代", ticker: "300750", price: 268.4, changePct: 3.1, facts: ["宁德时代回应大额回购方案"] },
  ],
  catalysts: [{ name: "兆易创新", label: "半年报预约披露", date: "2026-07-30" }],
};

describe("tradeDateOf — 日历日必须走本地时区", () => {
  it("晚间生成不能滚到前一天（toISOString 的 UTC 陷阱）", () => {
    // 本地 2026-08-15 00:30 —— UTC 还是 8/14
    expect(tradeDateOf(new Date(2026, 7, 15, 0, 30))).toBe("2026-08-15");
    expect(tradeDateOf(new Date(2026, 7, 15, 23, 59))).toBe("2026-08-15");
  });
});

describe("digestInputHash — 同输入不重复烧 token", () => {
  it("同样输入得同样指纹", () => {
    expect(digestInputHash(inputs)).toBe(digestInputHash({ ...inputs }));
  });
  it("任一段数据变了指纹就变", () => {
    const changed = { ...inputs, indices: [{ label: "上证指数", price: 3400, changePct: -0.2 }] };
    expect(digestInputHash(changed)).not.toBe(digestInputHash(inputs));
  });
});

describe("buildDigestPrompt", () => {
  const p = buildDigestPrompt(inputs);
  it("把五段的原始数据都喂进去", () => {
    expect(p).toContain("上证指数");
    expect(p).toContain("半导体");
    expect(p).toContain("白酒");
    expect(p).toContain("宁德时代");
    expect(p).toContain("东山精密");
    expect(p).toContain("半年报预约披露");
  });
  it("要求返回 JSON 且列明字段", () => {
    expect(p).toContain("JSON");
    expect(p).toContain("judgment");
    expect(p).toContain("watchpoints");
  });
  it("显式禁止把段号 / 字段名前缀写进正文（模型实测会照抄模板里的说明文字）", () => {
    expect(p).toContain("不要出现「1.」");
    expect(p).not.toContain('"overview": "1.');
  });
  it("空板块/空催化不会渲染成空洞占位", () => {
    const bare = buildDigestPrompt({ ...inputs, sectors: { strong: [], weak: [] }, catalysts: [] });
    expect(bare).not.toContain("undefined");
    expect(bare).toContain("（无）");
  });
});

describe("parseDigestResponse", () => {
  const good = JSON.stringify({
    overview: "沪指小幅收涨，创业板指走弱，市场情绪分化。",
    drivers: [
      { scope: "domestic", text: "半导体设备招标落地，年内第三批集采启动" },
      { scope: "domestic", text: "北向资金净流入 62 亿元，连续三日加仓" },
    ],
    sectors: { strong: [{ name: "半导体", note: "设备招标带动" }], weak: [{ name: "白酒", note: "需求担忧" }] },
    stocks: [{ name: "宁德时代", changePct: 3.1, note: "回购方案获积极反馈" }],
    watchpoints: ["兆易创新半年报预约披露", "美联储议息"],
    judgment: "若半导体招标持续落地，板块或延续修复；反之若需求端数据转弱，当前涨幅可能回吐。",
  });

  const stockFacts = [{ name: "宁德时代", facts: ["宁德时代回应大额回购方案"] }];

  const sectorFacts = [
    { name: "半导体", facts: ["兆易创新:半年度业绩预告"] },
    { name: "白酒", facts: [] },
  ];

  it("解析标准 JSON", () => {
    const d = parseDigestResponse(good, null, stockFacts, sectorFacts);
    expect(d).not.toBeNull();
    expect(d!.drivers).toHaveLength(2);
    // 旧的三层值（overseas/domestic/industry）自动映射到六类——库里存着几万条历史行，
    // 不能因为扩类就让它们渲染到错误的分组里
    expect(d!.drivers[0]!.scope).toBe("macro");
    expect(d!.sectors.strong[0]!.name).toBe("半导体");
    // 半导体当天有代表股事实 → note 留得下；白酒没有 → 置空
    expect(d!.sectors.strong[0]!.note).toBe("设备招标带动");
    expect(d!.sectors.weak[0]!.note).toBe("");
    expect(d!.watchpoints).toContain("美联储议息");
  });

  it("容忍 ```json 围栏（模型常见habit）", () => {
    expect(parseDigestResponse("```json\n" + good + "\n```")).not.toBeNull();
    expect(parseDigestResponse("好的，结果如下：\n" + good)).not.toBeNull();
  });

  it("缺必填段落 → null（宁可不出，也不出半截）", () => {
    const noJudge = JSON.stringify({ ...JSON.parse(good), judgment: "" });
    expect(parseDigestResponse(noJudge)).toBeNull();
    expect(parseDigestResponse("完全不是 JSON")).toBeNull();
    expect(parseDigestResponse("")).toBeNull();
  });

  it("字段类型不对时丢掉该条而不是整体崩", () => {
    const messy = JSON.stringify({
      ...JSON.parse(good),
      // 裸字符串是改版前的旧形态，仍要接得住（按「产业与公司」兜底）
      drivers: ["央行开展 2065 亿元逆回购", 42, null, "SK海力士称 HBM4 下半年扩产"],
      stocks: [{ name: "宁德时代", changePct: "三点一", note: "回购方案落地" }],
    });
    const d = parseDigestResponse(messy);
    expect(d!.drivers.map((x) => x.text)).toEqual([
      "央行开展 2065 亿元逆回购",
      "SK海力士称 HBM4 下半年扩产",
    ]);
    expect(d!.drivers[0]!.scope).toBe("industry");
    expect(d!.stocks[0]!.changePct).toBeNull();
  });

  it("核心驱动全是循环归因 → 整篇判废（张楚寒：正确的废话比没有更糟）", () => {
    const waffle = JSON.stringify({
      ...JSON.parse(good),
      drivers: [
        { scope: "industry", text: "半导体板块集体下挫，拖累科技股表现" },
        { scope: "industry", text: "科技股整体回调，个股普遍承压" },
        { scope: "industry", text: "市场情绪偏谨慎，资金避险" },
      ],
    });
    expect(parseDigestResponse(waffle)).toBeNull();
  });

  it("个股 note 是废话就置空，不留占位", () => {
    const d = parseDigestResponse(
      JSON.stringify({
        ...JSON.parse(good),
        stocks: [{ name: "兆易创新", changePct: -10, note: "受半导体板块影响走跌" }],
        sectors: { strong: [{ name: "白酒", note: "板块走强" }], weak: [] },
      }),
      null,
      [{ name: "兆易创新", facts: ["兆易创新二连跌停，机构警告存储行情拐点"] }],
      [{ name: "白酒", facts: ["贵州茅台:关于回购股份的公告"] }],
    );
    expect(d!.stocks[0]!.note).toBe("");
    expect(d!.sectors.strong[0]!.note).toBe("");
  });

  it("没喂过自有事实的个股，归因一律作废——防「看起来很像真的」的编造", () => {
    const body = JSON.stringify({
      ...JSON.parse(good),
      stocks: [{ name: "东山精密", changePct: -6.67, note: "PCB 订单超预期带动估值修复" }],
    });
    expect(parseDigestResponse(body, null, [{ name: "东山精密", facts: [] }])!.stocks[0]!.note).toBe("");
    expect(
      parseDigestResponse(body, null, [
        { name: "东山精密", facts: ["东山精密:上半年PCB订单同比增长"] },
      ])!.stocks[0]!.note,
    ).toBe("PCB 订单超预期带动估值修复");
  });

  it("市场宽度由调用方传入，不经模型（数字由代码算）", () => {
    const b = { counted: 10, up: 3, down: 7, flat: 0, limitUp: 0, limitDown: 1, medianChangePct: -1.2 };
    expect(parseDigestResponse(good, b)!.breadth).toEqual(b);
    expect(parseDigestResponse(good)!.breadth).toBeNull();
  });

  it("含买卖指令的判断段直接判废（铁律②）", () => {
    const bad = JSON.stringify({ ...JSON.parse(good), judgment: "建议买入半导体龙头，目标价 80 元。" });
    expect(parseDigestResponse(bad)).toBeNull();
  });
});

describe("cleanEntityName — 资金流数据里的名字自带代码后缀", () => {
  it("剥掉尾部代码，避免提示词里出现「新易盛(300502)(300502)」", () => {
    expect(cleanEntityName("新易盛(300502)")).toBe("新易盛");
    expect(cleanEntityName("贵州茅台(600519)")).toBe("贵州茅台");
    expect(cleanEntityName("大普微-UW(301666)")).toBe("大普微-UW");
  });
  it("不误伤本来就带括号的正常名字", () => {
    expect(cleanEntityName("中巨芯-U")).toBe("中巨芯-U");
    expect(cleanEntityName("宁德时代")).toBe("宁德时代");
  });
});

describe("isDigestWorthyFiling — 复盘里不要程序性公告", () => {
  it("剔除募集资金专户 / 开户 / 监管协议这类纯事务性文件", () => {
    expect(isDigestWorthyFiling("盛龙股份:关于开立募集资金现金管理专用结算账户并签订募集资金监管协议的公告")).toBe(false);
    expect(isDigestWorthyFiling("微电生理:关于开立募集资金专项账户并签订募集资金专户存储三方监管协议的公告")).toBe(false);
  });
  it("剔除中介机构出具的核查意见（主体公告本身已进来了）", () => {
    expect(isDigestWorthyFiling("东方证券:浙商证券关于东方证券本次交易不构成重组上市的核查意见")).toBe(false);
  });
  // 2026-08-03：同板块事实里冒出两条申报材料的**文件名**，占着位置却什么都没说。
  it("剔除交易所申报材料的文件名（开头是册号 + 申报稿/修订稿这类标记）", () => {
    expect(
      isDigestWorthyFiling("2-1重大资产重组报告书(申报稿)(天水华天科技股份有限公司)"),
    ).toBe(false);
    expect(
      isDigestWorthyFiling(
        "1关于天水华天科技股份有限公司发行股份及支付现金购买资产并募集配套资金申请的审核问询函的回复(修订稿)",
      ),
    ).toBe(false);
  });
  it("但「以数字开头」本身不算——只看这一条会把真标题一起杀掉", () => {
    expect(isDigestWorthyFiling("3家公司披露半年报，两家净利翻倍")).toBe(true);
    expect(isDigestWorthyFiling("5G基站建设加速，产业链订单回暖")).toBe(true);
    expect(isDigestWorthyFiling("2026年半年度业绩预告：净利润同比增长60%")).toBe(true);
  });
  it("保留真正的市场级事件", () => {
    expect(isDigestWorthyFiling("国泰海通:关于与关联方共同参与东方证券相关重组交易暨关联交易的公告")).toBe(true);
    expect(isDigestWorthyFiling("仁度生物:关于控股股东、实际控制人协议转让股份暨控制权拟发生变更的进展公告")).toBe(true);
    expect(isDigestWorthyFiling("蓝盾光电:关于筹划发行股份及支付现金购买资产并募集配套资金事项的停牌公告")).toBe(true);
    expect(isDigestWorthyFiling("东山精密:关于首次回购公司股份的公告")).toBe(true);
  });
});

describe("合规护栏", () => {
  it("识别买卖指令 / 目标价 / 收益承诺", () => {
    expect(hasForbiddenAdvice("建议买入")).toBe(true);
    expect(hasForbiddenAdvice("目标价 80 元")).toBe(true);
    expect(hasForbiddenAdvice("可逢低加仓")).toBe(true);
    expect(hasForbiddenAdvice("必涨")).toBe(true);
    expect(hasForbiddenAdvice("建议清仓")).toBe(true);
  });
  it("不误伤中性陈述", () => {
    expect(hasForbiddenAdvice("公司披露回购方案，回购价格上限 80 元")).toBe(false);
    expect(hasForbiddenAdvice("北向资金净买入居前")).toBe(false);
    expect(hasForbiddenAdvice("若数据转弱，涨幅可能回吐")).toBe(false);
  });
  it("判断段必须双向——单边论断不合格", () => {
    expect(isTwoSided("若 A 成立则修复；反之若 B 则回吐。")).toBe(true);
    expect(isTwoSided("一旦财报不及预期，波动可能放大。反之，若指引改善则获支撑。")).toBe(true);
    expect(isTwoSided("市场将继续上涨。")).toBe(false);
  });
});

describe("normalizeScope — 三层扩到六类，历史数据不能渲染错组", () => {
  it("旧值映射：overseas→global、domestic→macro、industry 不变", () => {
    expect(normalizeScope("overseas")).toBe("global");
    expect(normalizeScope("domestic")).toBe("macro");
    expect(normalizeScope("industry")).toBe("industry");
  });
  it("新值原样保留", () => {
    for (const c of ["global", "macro", "industry", "company", "flow", "calendar"]) {
      expect(normalizeScope(c)).toBe(c);
    }
  });
  it("垃圾值兜底到 industry，不崩", () => {
    expect(normalizeScope(undefined)).toBe("industry");
    expect(normalizeScope(42)).toBe("industry");
    expect(normalizeScope("nonsense")).toBe("industry");
  });
});

describe("buildDigestPrompt — 事件清单要把「已经筛过了」讲清楚", () => {
  it("六类都出现，空类要显式说明今天没事（否则模型会去别类借素材凑）", () => {
    const p = buildDigestPrompt(inputs);
    expect(p).toContain("全球市场");
    expect(p).toContain("国内宏观");
    expect(p).toContain("资金");
    expect(p).toContain("【日历】（今日无入选事件");
  });
  it("告诉模型候选池多大、判据是什么——它的活是写不是再筛一遍", () => {
    const p = buildDigestPrompt(inputs);
    expect(p).toContain("87 条候选事件"); // 12+9+20+40+6+0
    expect(p).toContain("与用户持仓的相关度");
    expect(p).toContain("不是再做一次筛选");
  });
  it("一手来源与多源同报要标出来", () => {
    const p = buildDigestPrompt(inputs);
    expect(p).toContain("一手");
    expect(p).toContain("2源同报");
  });
});

// 张楚寒 2026-07-31：「昨晚美股的信息没 update 上去」——复盘 15:40 才生成，
// 早上看到的永远是昨天那份。盘前简报是**另一个场次**，可用数据完全不同。
describe("buildDigestPrompt — 盘前场次", () => {
  const pre: DigestInputs = { ...inputs, session: "preopen", breadth: null, sectors: { strong: [], weak: [] }, stocks: [] };

  it("讲的是「开盘前」，并明确禁止预测今天怎么走", () => {
    const p = buildDigestPrompt(pre);
    expect(p).toContain("开盘前");
    expect(p).toContain("今天还没开盘");
  });

  it("不要板块/个股字段——盘前没有当日行情，硬给会逼模型编", () => {
    const p = buildDigestPrompt(pre);
    expect(p).not.toContain("今日强势板块");
    expect(p).not.toContain("重点个股");
    expect(p).toContain('"sectors":{"strong":[],"weak":[]}');
  });

  it("事件清单与条数要求照旧（否则模型又把筛选做两遍）", () => {
    const p = buildDigestPrompt(pre);
    expect(p).toContain("全球市场");
    expect(p).toContain("你就要写 5 条 driver");
  });

  it("收盘场次不受影响，仍然给板块与个股", () => {
    const p = buildDigestPrompt(inputs);
    expect(p).toContain("今日强势板块");
    expect(p).toContain("重点个股");
  });
});
