import { describe, it, expect } from "vitest";

import { filingExcerpt, excerptIsEmpty } from "./filing-excerpt";

// 取自库里的真实公告开头（脱敏保留结构）——回归的锚点就是"卡片别再只显示套话"
const REAL_FILING =
  "恒力石化股份有限公司 证券代码：600346 证券简称：恒力石化 公告编号：2026-036 " +
  "恒力石化股份有限公司 关于回购股份事项前十名股东持股信息的公告 " +
  "本公司董事会及全体董事保证本公告内容不存在任何虚假记载、误导性陈述 或者重大遗漏，" +
  "并对其内容的真实性、准确性和完整性承担法律责任。 " +
  "恒力石化股份有限公司（以下简称“公司”）于 2026 年 7 月 20 日召开的第十届董事会第六次会议" +
  "审议通过了《关于第五期以集中竞价交易方式回购股份的回购报告书的议案》。";

describe("filingExcerpt", () => {
  it("剥掉法定套话后，摘录从真正说事的地方开始", () => {
    const out = filingExcerpt("恒力石化:恒力石化关于回购股份事项前十名股东持股信息的公告", REAL_FILING);
    // 关键事实必须保留
    expect(out).toContain("董事会第六次会议");
    expect(out).toContain("回购");
    // 套话必须消失
    expect(out).not.toContain("证券代码");
    expect(out).not.toContain("公告编号");
    expect(out).not.toContain("承担法律责任");
    expect(out).not.toContain("虚假记载");
  });

  it("不重复标题（正文里再印一遍标题要剥掉）", () => {
    const out = filingExcerpt("恒力石化:恒力石化关于回购股份事项前十名股东持股信息的公告", REAL_FILING);
    expect(out.startsWith("关于回购股份事项前十名股东持股信息的公告")).toBe(false);
  });

  it("不以悬空的定义括号开头", () => {
    const out = filingExcerpt("恒力石化:恒力石化关于回购股份事项前十名股东持股信息的公告", REAL_FILING);
    expect(out.startsWith("以下简称")).toBe(false);
    expect(out.startsWith("）")).toBe(false);
  });

  it("覆盖 股票简称/编号 的变体写法", () => {
    const src =
      "证券代码：600196 股票简称：复星医药 编号：临 2026-099 上海复星医药（集团）股份有限公司 " +
      "关于股东部分股份解除质押的公告 截至 2026 年 7 月 21 日收市，控股股东持有本公司 961,424,455 股股份。";
    const out = filingExcerpt("复星医药:复星医药关于股东部分股份解除质押的公告", src);
    expect(out).not.toContain("股票简称");
    expect(out).not.toContain("2026-099");
    expect(out).toContain("961,424,455"); // 数字原样保留（铁律③不失真）
  });

  it("数字与原文照抄，不改写不概括", () => {
    const src = "证券代码：000001 本公司董事会保证内容真实。 拟以 12.34 元/股回购不超过 5,000,000 股。";
    const out = filingExcerpt("某公司:回购公告", src);
    expect(out).toContain("12.34");
    expect(out).toContain("5,000,000");
  });

  it("超长时在句末截断、并给出省略号", () => {
    const long = "证券代码：000001 " + "公司经营情况持续改善且订单饱满。".repeat(20);
    const out = filingExcerpt("某公司:经营公告", long, 60);
    expect(out.length).toBeLessThanOrEqual(62);
  });

  it("空正文返回空串", () => {
    expect(filingExcerpt("标题", "")).toBe("");
  });
});

describe("免责声明的各种变体（按句丢弃，非枚举句式）", () => {
  // 这些变体都是实测从库里捞出来、曾经漏网的写法
  const variants = [
    "本公司及董事会全体成员保证信息披露内容的真实、准确、完整， 没有虚假记载、误导性陈述或重大遗漏。",
    "本公司董事会及全体董事保证公告内容不存在任何虚假记载、误导性陈述或者重大遗漏，并对其内容的真实性、准确性和完整性依法承担法律责任。",
    "公司控股股东保证向本公司提供的信息内容真实、准确、完整，没有虚假记载、误导性陈述或重大遗漏。",
    "本公司及董事会全体成员保证公告内容与信息披露义务人提供的信息一致。",
  ];

  it.each(variants)("丢弃免责句但保留后面的实质内容: %s", (dis) => {
    const src = `${dis} 公司于 2026 年 7 月 23 日获批 1 类创新药上市。`;
    const out = filingExcerpt("某公司:获批公告", src);
    expect(out).toContain("1 类创新药");
    expect(out).not.toContain("保证");
    expect(out).not.toContain("虚假记载");
  });

  it("不误删含「保证」但确有信息的句子（如保证金/履约保证）", () => {
    const src = "公司中标金额 3.2 亿元，已缴纳履约保证金 1600 万元。";
    const out = filingExcerpt("某公司:中标公告", src);
    expect(out).toContain("3.2 亿元");
    expect(out).toContain("1600 万元");
  });
});

describe("excerptIsEmpty", () => {
  it("剥完只剩标点/数字时判为空（卡片就别显示摘录了）", () => {
    expect(excerptIsEmpty("（）、 2026-01")).toBe(true);
    expect(excerptIsEmpty("")).toBe(true);
  });
  it("有实质文字则不为空", () => {
    expect(excerptIsEmpty("董事会审议通过回购议案")).toBe(false);
  });
});
