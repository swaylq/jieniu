import { describe, expect, it } from "vitest";
import {
  marketRelevanceScore,
  macroSubjectOf,
  rankMacroCandidates,
  type RankableMacro,
} from "./macro-relevance";

// 夹具全部是 2026-07-29 真实候选池里的标题（诊断脚本导出），不手写。
const m = (title: string, importance = 30, brief = ""): RankableMacro => ({
  title,
  brief,
  source: "东方财富·快讯",
  importance,
});

describe("marketRelevanceScore", () => {
  it("硬事件 + 金额的产业消息分数高于同 importance 的行政会议", () => {
    const good = marketRelevanceScore("旺宏：192层3D NAND预计2027年量产 追加158亿新台币投资");
    const admin = marketRelevanceScore("新疆通信管理局召开2026年上半年重点工作推进会");
    expect(good).toBeGreaterThan(admin);
    expect(admin).toBeLessThan(0);
  });

  it("行政/规范/合规体裁一律负分", () => {
    for (const t of [
      "沪发布户外广告合规指引：禁止贩卖容貌焦虑 电梯夜间禁播有声广告",
      "聚焦智能家电质量安全风险 市场监管总局发布国家标准",
      "《智能家用电器质量安全风险分类评价指南》国家标准发布",
      "证券从业人员赵宇阳公开发表不当言论 被吉林证监局出具警示函",
      "国家烟草专卖局约谈爱奇迹（深圳）技术有限公司",
      "上交所投保专委会三大调研齐发，全面覆盖防非打非、AI应用与纠纷化解",
      "甘肃首单“保税+TIR”卡空联运业务成功落地兰州新区综合保税区",
    ]) {
      expect(marketRelevanceScore(t), t).toBeLessThan(0);
    }
  });

  it("民生 / 文体 / 天气 / 航天这类无定价含义的负分", () => {
    for (const t of [
      "2026年度共有7305位港澳居民投保“穗岁康”",
      "高温炙烤韩国 釜山破122年来最高气温纪录",
      "我国成功发射天链三号01星",
      "2026年度电影总票房突破220亿",
      "上半年国内电子竞技游戏、桌游市场销售收入同比双增长",
    ]) {
      expect(marketRelevanceScore(t), t).toBeLessThan(0);
    }
  });

  it("A股自身指数复述负分（宽度条已经给了数字，且它是结果不是原因）", () => {
    for (const t of [
      "创业板指跌近5.2% 已抹平今年全部涨幅",
      "科创50指数跌幅扩大至6%",
      "创业板指、科创综指盘中跌超3%",
      "科创50指数跌超6%。",
    ]) {
      expect(marketRelevanceScore(t), t).toBeLessThan(0);
    }
  });

  it("海外指数/龙头的异动**不**负分——那是 A 股的外生变量，不是复述", () => {
    for (const t of [
      "美股收盘：特朗普最后时刻砸盘 纳斯达克100指数坠入回调区间",
      "SK海力士跌逾17% 创纪录最大跌幅",
      "韩国股市迈向史上最大单月跌幅",
    ]) {
      expect(marketRelevanceScore(t), t).toBeGreaterThan(0);
    }
  });

  it("单只海外公司的盘前波动 / 目标价调整降权", () => {
    expect(marketRelevanceScore("伟创力美股盘前跌超11%")).toBeLessThan(
      marketRelevanceScore("巴斯夫将启动10亿欧元股份回购"),
    );
    expect(marketRelevanceScore("瑞穗下调康宁目标价")).toBeLessThan(0);
    expect(marketRelevanceScore("伯恩斯坦上调可口可乐目标股价")).toBeLessThan(0);
  });

  it("券商观点降权，但不低于行政噪音（观点仍是信息，会议通报不是）", () => {
    const view = marketRelevanceScore("中信证券：仍预计美联储今年全年按兵不动");
    const admin = marketRelevanceScore("新疆通信管理局召开2026年上半年重点工作推进会");
    expect(view).toBeGreaterThan(admin);
  });

  it("货币操作 / 关税 / 政策带数字的宏观得高分", () => {
    for (const t of [
      "中国央行公开市场开展2705亿元7天期逆回购操作，操作利率1.40%，持平上次。同时，开展了6000亿元隔夜逆回购操作。今日8040亿元逆回购到期。",
      "格芯获美国商务部3亿美元支持 加速硅光子技术研发以服务AI基础设施",
      "深圳：到2030年战略性新兴产业增加值达2.3万亿元、占地区生产总值比重达45%",
    ]) {
      expect(marketRelevanceScore(t), t).toBeGreaterThan(2);
    }
  });

  it("地缘军事无价格传导的降权，带油价/海峡的保留", () => {
    expect(marketRelevanceScore("伊朗谴责美国沙特袭击伊拉克")).toBeLessThan(0);
    expect(
      marketRelevanceScore("美媒：欧洲冷对美国所提霍尔木兹海峡巡逻计划"),
    ).toBeGreaterThan(marketRelevanceScore("伊媒称“敌方导弹”击中西阿塞拜疆省一无人居住区"));
  });
});

describe("marketRelevanceScore · 国内宏观体裁（2026-07-30 实测误杀的那一批）", () => {
  // 这一组全部是真实被 6 分门槛挡掉、而实际是真·当天宏观事件的条目。
  // 根因：硬事件词表按「产业事件」的形状写（扩产/订单/涨价/金额），政策类天生拿不到那么高分。
  it("政策 / 规划 / 统计数据类拿到正分，且不低于兜底门槛 3", () => {
    for (const t of [
      "多部门联合发布《国家应对气候变化“十五五”规划》",
      "邮政业“十五五”规划发布 2030年快递业务收入达2万亿元",
      "央行上海总部：6月末全市本外币贷款余额同比增长5.9% 新发放企业贷款加权平均利率为2.58%",
      "全国碳排放权成交额突破629亿元 覆盖范围将扩大",
      "四川发布城市更新机会清单 计划总投资5218亿元",
      "广州推出首个现房销售试点",
      "南向资金净卖出额达50亿港元",
    ]) {
      expect(marketRelevanceScore(t), t).toBeGreaterThanOrEqual(3);
    }
  });

  it("工商登记体裁负分——新设子公司自带「注册资本10亿」，别让金额把它捞上来", () => {
    for (const t of [
      "鸣鸣很忙等在上海成立食品公司",
      "山东数据集团登记成立 注册资本10亿",
      "中核（雄安）能源销售有限公司成立 注册资本2.01亿",
    ]) {
      expect(marketRelevanceScore(t), t).toBeLessThan(0);
    }
  });

  it("宣传体裁负分：动词是「筑牢 / 多措并举」，没有可核验的事实", () => {
    expect(marketRelevanceScore("山西多措并举筑牢迎峰度夏原煤保供防线")).toBeLessThan(0);
    expect(marketRelevanceScore("快递员权益保障升级 邮政业“十五五”规划亮出硬举措")).toBeLessThan(0);
  });

  it("「规划推进会」比「规划发布」低分——加分项与减分项按净分叠加", () => {
    expect(marketRelevanceScore("邮政业“十五五”规划发布")).toBeGreaterThan(
      marketRelevanceScore("邮政业“十五五”规划重点工作推进会召开"),
    );
  });
});

describe("macroSubjectOf", () => {
  it("同一件事的不同措辞归到同一个主体", () => {
    const ks = [
      "韩国股市迈向史上最大单月跌幅",
      "史无前例的“背靠背”熔断后 韩国监管紧急开会说了点啥？",
      "韩国将召开紧急会议讨论市场形势 此前韩股连续两日触发熔断",
      "韩国金融监管负责人就杠杆型ETF争议致歉 称将恢复市场信任",
    ].map((t) => macroSubjectOf(t));
    expect(new Set(ks).size).toBe(1);
    expect(ks[0]).toBe("韩国");
  });

  it("不同主体不合并", () => {
    expect(macroSubjectOf("美联储隔夜逆回购协议（RRP）使用规模为25.76亿美元")).toBe("美联储");
    expect(macroSubjectOf("中国央行公开市场开展2705亿元7天期逆回购操作")).toBe("央行");
    expect(macroSubjectOf("旺宏：192层3D NAND预计2027年量产")).toBe("旺宏");
  });

  it("认不出主体时返回 null（不参与收口，别把互不相关的挤成一个）", () => {
    expect(macroSubjectOf("光伏业“反内卷”进阶 “低于成本价销售”有了统一界定标尺")).toBeNull();
  });
});

describe("rankMacroCandidates", () => {
  it("同一主体最多留 perSubject 条，腾位置给别的事", () => {
    const cands = [
      m("韩国股市迈向史上最大单月跌幅", 70),
      m("史无前例的“背靠背”熔断后 韩国监管紧急开会说了点啥？", 70),
      m("韩国将召开紧急会议讨论市场形势 此前韩股连续两日触发熔断", 70),
      m("韩国金融监管负责人就杠杆型ETF争议致歉 称将恢复市场信任", 70),
      m("美股盘前：三大股指期货齐跌 微软、Meta财报来袭 美联储利率决议即将公布", 70),
      m("SK海力士跌逾17% 创纪录最大跌幅", 30),
    ];
    const out = rankMacroCandidates(cands, { perScope: 5, perSubject: 2 });
    const korean = out.overseas.filter((c) => c.title.includes("韩国"));
    expect(korean.length).toBe(2);
    // 腾出来的位置被别的海外主体拿到
    expect(out.overseas.some((c) => c.title.includes("美联储利率决议"))).toBe(true);
    expect(out.overseas.some((c) => c.title.includes("SK海力士"))).toBe(true);
  });

  it("相关性优先于 importance：低分硬事件排在高分行政通报之前", () => {
    const cands = [
      m("新疆通信管理局召开2026年上半年重点工作推进会", 70),
      m("沪发布户外广告合规指引：禁止贩卖容貌焦虑 电梯夜间禁播有声广告", 70),
      m("旺宏：192层3D NAND预计2027年量产 追加158亿新台币投资", 30),
      m("最高820亿！230余家公司密集回购", 55),
    ];
    const out = rankMacroCandidates(cands, { perScope: 2, perSubject: 2 });
    const industry = out.industry.map((c) => c.title);
    expect(industry[0]).toContain("旺宏");
    expect(industry.some((t) => t.includes("回购"))).toBe(true);
    expect(industry.some((t) => t.includes("重点工作推进会"))).toBe(false);
  });

  it("跨源同一件事仍按数字指纹去重（沿用既有规则）", () => {
    const cands = [
      m("中国央行公开市场开展2705亿元7天期逆回购操作，操作利率1.40%，持平上次", 55),
      m("中国人民银行以固定利率、数量招标方式开展了2705亿元7天期逆回购操作", 55),
    ];
    const out = rankMacroCandidates(cands, { perScope: 5, perSubject: 2 });
    expect(out.domestic.length).toBe(1);
  });

  it("负分条目在还有正分候选时不占位", () => {
    const cands = [
      m("我国成功发射天链三号01星", 30),
      m("央行开展6000亿元隔夜逆回购操作", 55),
    ];
    const out = rankMacroCandidates(cands, { perScope: 1, perSubject: 2 });
    expect(out.domestic.length + out.industry.length + out.overseas.length).toBe(1);
    expect([...out.domestic, ...out.industry, ...out.overseas][0]!.title).toContain("逆回购");
  });

  // 原 digest-substance.test.ts「按 scope 分组、各自限量」那条，随选材本体一起搬过来
  it("按 scope 分层限量，并折叠跨源重复的同一件事", () => {
    const picked = rankMacroCandidates(
      [
        m("央行今日开展2065亿元7天期逆回购操作", 55),
        // 见闻同一件事的另一条措辞——数字指纹相同，应被折叠
        m("央行今日开展2065亿元7天期逆回购操作，操作利率为1.40%", 55),
        m("住建部：扎实做好国债支持老旧小区加装电梯项目", 70),
        m("SK海力士：HBM4将于下半年扩大生产", 70),
        m("韩国承诺采取更多措施抑制杠杆ETF需求", 70),
        m("“废里淘金” 多家环保资源化企业上半年业绩预喜", 70),
        m("某某科技龙虎榜数据（7月28日）", 60),
      ],
      { perScope: 2, perSubject: 2 },
    );
    expect(picked.domestic.map((x) => x.title)).toEqual([
      "央行今日开展2065亿元7天期逆回购操作",
      "住建部：扎实做好国债支持老旧小区加装电梯项目",
    ]);
    expect(picked.overseas).toHaveLength(2);
    expect(picked.industry).toHaveLength(1);
    expect(JSON.stringify(picked)).not.toContain("龙虎榜");
  });

  it("语序被打乱的同一件事按二元组包含率收口（前缀子串判定拦不住）", () => {
    // 2026-07-30 真实数据：这三条各占了一个产业位
    const out = rankMacroCandidates(
      [
        m("业绩确定叠加分红稳定 沪主板蓝筹走强", 50),
        m("沪市主板蓝筹股逆势走强 业绩确定叠加分红稳定成“避风港”", 50),
        m("沪主板蓝筹逆势走强 业绩确定叠加分红稳定成“避风港”", 50),
        m("旺宏：192层3D NAND预计2027年量产 追加158亿新台币投资", 70),
      ],
      { perScope: 6, perSubject: 2 },
    );
    expect(out.industry.filter((c) => c.title.includes("蓝筹"))).toHaveLength(1);
    expect(out.industry.some((c) => c.title.includes("旺宏"))).toBe(true);
  });

  it("minScore：只收好料，不拿低分条目把配额填满", () => {
    const out = rankMacroCandidates(
      [
        m("中国央行公开市场开展2705亿元7天期逆回购操作，操作利率1.40%，持平上次", 55),
        m("苏州上半年签约亿元以上项目1594个", 30),
        m("荣耀更新IPO辅导备案报告", 30),
        m("上交所终止对韬盛科技科创板IPO的审核", 30),
      ],
      { perScope: 6, perSubject: 2, minScore: 6 },
    );
    const all = [...out.overseas, ...out.domestic, ...out.industry].map((c) => c.title);
    expect(all).toContain(
      "中国央行公开市场开展2705亿元7天期逆回购操作，操作利率1.40%，持平上次",
    );
    expect(all.some((t) => t.includes("IPO"))).toBe(false);
    expect(all.some((t) => t.includes("招商") || t.includes("亿元以上项目"))).toBe(false);
  });

  it("floorPerScope：好料不足时从次一档补，别让词表的洞把整层清空", () => {
    // 「政治局会议召开」不带数字、不含硬事件词，只拿到 POLICY_BODY 的 +2——正是词表的洞
    const cands = [m("中共中央政治局会议召开", 70), m("国务院常务会议召开", 70)];
    const strict = rankMacroCandidates(cands, { perScope: 6, perSubject: 2, minScore: 6 });
    expect(strict.domestic).toHaveLength(0);
    const withFloor = rankMacroCandidates(cands, {
      perScope: 6,
      perSubject: 2,
      minScore: 6,
      floorPerScope: 2,
    });
    expect(withFloor.domestic).toHaveLength(2);
  });

  it("宁可给少也不给废话：全是负分时该层留空", () => {
    const out = rankMacroCandidates(
      [m("高温炙烤韩国 釜山破122年来最高气温纪录", 30), m("2026年度电影总票房突破220亿", 30)],
      { perScope: 3, perSubject: 2 },
    );
    expect(out.overseas.length + out.domestic.length + out.industry.length).toBe(0);
  });
});
