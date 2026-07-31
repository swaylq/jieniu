import { describe, it, expect } from "vitest";
import { parseSweepPage } from "./eastmoney-report-sweep";

/** 夹具从真实响应拷贝（2026-07-31 实测 reportapi.eastmoney.com，qType=0）。 */
const REAL = {
  hits: 85,
  size: 2,
  data: [
    {
      title: "公司事件点评报告：传统主业周期承压，智算转型开启价值重估",
      stockName: "京基智农",
      stockCode: "000048",
      orgSName: "华鑫证券",
      publishDate: "2026-07-31 00:00:00.000",
      infoCode: "AP202607311827509705",
      predictNextTwoYearEps: "1.91",
      emRatingName: "买入",
      indvAimPriceT: "25.00",
    },
    {
      title: "维持买入评级，目标价45元",
      stockName: "某公司",
      stockCode: "000001",
      orgSName: "某券商",
      publishDate: "2026-07-30 00:00:00.000",
      infoCode: "AP2026073000000001",
    },
  ],
};

describe("parseSweepPage", () => {
  it("解析出标题、机构、代码、日期与详情链接", () => {
    const rows = parseSweepPage(REAL);
    const r = rows[0]!;
    expect(r.title).toContain("智算转型");
    expect(r.url).toContain("AP202607311827509705");
    expect(r.entityHints).toContain("000048");
    expect(r.entityHints).toContain("京基智农");
    expect(r.publishedAt.toISOString().slice(0, 10)).toBe("2026-07-31");
  });

  it("摘要里带上机构名——「谁写的」是研报这类证据的关键信息", () => {
    expect(parseSweepPage(REAL)[0]!.summary).toContain("华鑫证券");
  });

  it("标题含评级 / 目标价的整条丢弃（合规铁律：不荐股不喊价）", () => {
    const rows = parseSweepPage(REAL);
    expect(rows.map((r) => r.title)).not.toContain("维持买入评级，目标价45元");
    expect(rows).toHaveLength(1);
  });

  it("评级 / 目标价 / 盈利预测字段一律不带进结果", () => {
    const json = JSON.stringify(parseSweepPage(REAL));
    expect(json).not.toContain("1.91");
    expect(json).not.toContain("买入");
    expect(json).not.toContain("25.00");
  });

  it("eventType 标成「研报」，供催化分级识别", () => {
    expect(parseSweepPage(REAL)[0]!.eventType).toBe("研报");
  });

  it("结构不对 / 缺必需字段 → 跳过，不抛", () => {
    expect(parseSweepPage(null)).toEqual([]);
    expect(parseSweepPage({ data: "x" })).toEqual([]);
    expect(parseSweepPage({ data: [{ title: "无代码" }] })).toEqual([]);
    expect(
      parseSweepPage({ data: [{ title: "t", stockCode: "000001", publishDate: "坏日期", infoCode: "i" }] }),
    ).toEqual([]);
  });
});
