import { describe, expect, it } from "vitest";

import {
  REPRINT_BODY_MIN,
  collapseReprints,
  groupReprints,
  stripOutletTag,
  type ReprintItem,
} from "./reprint";

// 现场原文（国盾量子 688027 个股页「资讯」tab，2026-08-18 08:00 前后 sway 截图那一屏）：
// 频准激光 688826 上市首日的同一篇通稿，被十几家媒体各自改标题转发。
const at = (hhmm: string) => new Date(`2026-08-18T${hhmm}:00+08:00`);

const REPRINT_BODY =
  "在量子科技领域，公司产品主要服务于中国科学院、清华大学、哈佛大学、科罗拉多大学、麻省理工学院等国内外知名高校、研究院所和国盾量子、华翊量子、国仪量子等量子科技公司。在半导体领域，主要覆盖中安半导体、昂坤视觉等国内半导体设备厂商。";

const mk = (o: Partial<ReprintItem> & { id: string }): ReprintItem => ({
  title: "标题",
  summary: REPRINT_BODY,
  tier: "MEDIA",
  importance: 0,
  publishedAt: at("10:00"),
  ...o,
});

describe("stripOutletTag", () => {
  it("剥掉东财盖在转载稿上的媒体署名", () => {
    expect(stripOutletTag("【金融投资报】具体来看，在量子科技领域…")).toBe(
      "具体来看，在量子科技领域…",
    );
    expect(stripOutletTag("【新华财经】在量子科技领域，公司产品…")).toBe(
      "在量子科技领域，公司产品…",
    );
  });

  it("署名后跟标点也一并吃掉（【每日经济新闻】，频准激光…）", () => {
    expect(stripOutletTag("【每日经济新闻】，频准激光将产品销往哈佛大学")).toBe(
      "频准激光将产品销往哈佛大学",
    );
  });

  it("正文里出现的方括号不动（只剥开头那个）", () => {
    expect(stripOutletTag("公司公告【重大事项】称，本次交易…")).toBe(
      "公司公告【重大事项】称，本次交易…",
    );
  });
});

describe("collapseReprints", () => {
  it("同一篇通稿的多家转载折成一条，reprintCount 记被折掉的份数", () => {
    const out = collapseReprints([
      mk({
        id: "a",
        title: "A股最大“肉签”诞生！频准激光 (688826)上市首日最高涨幅595.6%，中一签最高浮盈55.65万元",
        summary: `【金融投资报】具体来看，${REPRINT_BODY}`,
        publishedAt: at("15:16"),
      }),
      mk({
        id: "b",
        title: "A股年内最贵新股688826今日上市，大涨逾500%，中一签赚超45万",
        summary: `【消费日报财经】${REPRINT_BODY}`,
        publishedAt: at("11:30"),
      }),
      mk({
        id: "c",
        title: "A股最大“肉签”诞生！中一签最高赚55.65万元",
        summary: `【金融投资网】具体来看，公司${REPRINT_BODY}`,
        publishedAt: at("11:18"),
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("a");
    expect(out[0]!.reprintCount).toBe(2);
  });

  it("标题只差标点的同一条快讯也折（正文各异时靠标题兜底）", () => {
    const out = collapseReprints([
      mk({
        id: "a",
        title: "开盘暴涨超595%！中一签赚逾55万元！最贵新股来了",
        summary: "招股书显示，频准激光的客户覆盖哈佛、麻省理工、清华大学。",
        publishedAt: at("10:03"),
      }),
      mk({
        id: "b",
        title: "开盘，暴涨超595%！中一签，狂赚逾55万元！最贵新股，来了",
        summary: "另一段完全不同的导语，讲的是发行价与募资规模的事。",
        publishedAt: at("09:44"),
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.reprintCount).toBe(1);
  });

  it("摘要太短不拿来判重——同一家公司两件真事不会被财务样板句并掉", () => {
    // 实测误折现场：赣锋锂业两条不同事件共用「2026年一季度…收入91.96亿元」这句样板。
    const boilerplate = "2026年一季度，赣锋锂业实现收入91.96亿元，归母净利润18.37亿元。";
    expect(boilerplate.replace(/[\s\p{P}\p{S}]/gu, "").length).toBeLessThan(
      REPRINT_BODY_MIN,
    );
    const out = collapseReprints([
      mk({ id: "a", title: "赣锋锂业申请氢氧化锂指定交割厂库资质", summary: boilerplate }),
      mk({
        id: "b",
        title: "赣锋锂业拟出资1亿元认购合伙企业45.87%份额",
        summary: boilerplate,
        publishedAt: at("09:00"),
      }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((x) => x.reprintCount === 0)).toBe(true);
  });

  it("超出转载窗（48h）的同稿不折——同名周期性稿是两件真事", () => {
    const out = collapseReprints([
      mk({ id: "a", publishedAt: new Date("2026-08-18T10:00:00+08:00") }),
      mk({ id: "b", publishedAt: new Date("2026-08-14T10:00:00+08:00") }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("一手公告（PRIMARY）永不参与折叠，原样穿过", () => {
    const out = collapseReprints([
      mk({ id: "p1", tier: "PRIMARY", title: "关于回购公司股份进展的公告" }),
      mk({ id: "p2", tier: "PRIMARY", title: "关于回购公司股份进展的公告" }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["p1", "p2"]);
    expect(out.every((x) => x.reprintCount === 0)).toBe(true);
  });

  it("代表选标题点到主体的那条，不选混进来的早报", () => {
    const subject = { name: "万华化学(600309)", ticker: "600309" };
    const body =
      "万华化学公告称，公司烟台产业园110万吨/年MDI装置及相关配套装置将于2026年8月10日开始停产检修，预计检修时间45天。";
    const out = collapseReprints(
      [
        mk({ id: "roundup", title: "8月4日晚间沪深上市公司重大事项公告最新快递", summary: body, publishedAt: at("20:10") }),
        mk({ id: "real", title: "万华化学：烟台产业园110万吨/年MDI装置将停产检修", summary: body, publishedAt: at("19:40") }),
      ],
      subject,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("real");
    expect(out[0]!.reprintCount).toBe(1);
  });

  it("整段都是免责声明的摘要不拿来判重——28 家公司的调研快报不是同一篇稿", () => {
    // 实测误折现场：东财「调研快报」的 summary 从头到尾是同一段免责声明，
    // 28 家不同公司的机构调研记录正文一字不差，不剥就被判成「同一篇稿转载 27 次」。
    const disclaimer =
      "【东方财富Choice数据】东方财富发布此内容旨在传播更多信息，与本平台立场无关。东方财富力求但不保证数据的完全准确，如有错漏请以中国证监会指定上市公司信息披露媒体为准。";
    const out = collapseReprints([
      mk({ id: "a", title: "【调研快报】瑞纳智能接待财通证券研究所等9家机构调研", summary: disclaimer }),
      mk({ id: "b", title: "【调研快报】通策医疗接待中信建投证券等6家机构调研", summary: disclaimer, publishedAt: at("09:00") }),
      mk({ id: "c", title: "【调研快报】福田汽车接待中泰证券等8家机构调研", summary: disclaimer, publishedAt: at("08:00") }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((x) => x.reprintCount === 0)).toBe(true);
  });

  it("免责声明只占摘要一部分时，仍拿剩下的正文判重", () => {
    const body = (lead: string) =>
      `${lead}公司公告称，控股子公司拟以自有资金 3.2 亿元投资建设年产 5 万吨锂电池负极材料项目，建设期 18 个月。本文不构成投资建议，据此操作风险自担。`;
    const out = collapseReprints([
      mk({ id: "a", title: "某公司拟3.2亿元投建负极材料项目", summary: body("【证券时报网】") }),
      mk({ id: "b", title: "投资3.2亿！负极材料再添新产能", summary: body("【中国证券报】"), publishedAt: at("09:20") }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.reprintCount).toBe(1);
  });

  it("groupReprints 给出簇的全貌：代表 + 全部成员（含代表），按输入顺序", () => {
    const groups = groupReprints([
      mk({ id: "a", title: "频准激光上市首日暴涨595%", summary: `【中国证券报】${REPRINT_BODY}` }),
      mk({ id: "b", title: "最贵新股来了，一签赚55万", summary: `【券商中国】${REPRINT_BODY}`, publishedAt: at("09:40") }),
      mk({ id: "c", title: "公司披露半年度业绩预增公告", summary: "公司预计上半年归母净利润 4.2 亿元至 4.8 亿元，同比增长 62%~85%，主要因主营产品量价齐升。", publishedAt: at("08:00") }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.members.map((m) => m.id)).toEqual(["a", "b"]);
    expect(groups[0]!.representative.id).toBe("a");
    expect(groups[1]!.members.map((m) => m.id)).toEqual(["c"]);
  });

  it("不相干的资讯各自成条，顺序不变", () => {
    const out = collapseReprints([
      mk({ id: "a", title: "公司中标 12 亿元光伏组件订单", summary: "中标公告显示，本次中标金额约12.3亿元，占最近一期经审计营业收入的 8.4%，将于明年确认收入。" }),
      mk({ id: "b", title: "公司董事长辞职", summary: "公司公告，董事长因个人原因辞去董事长及董事会专门委员会相关职务，辞任后不再担任公司任何职务。", publishedAt: at("09:30") }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
    expect(out.every((x) => x.reprintCount === 0)).toBe(true);
  });
});
