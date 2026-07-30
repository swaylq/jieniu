import { describe, it, expect } from "vitest";

import { parseEastmoneyFastNews } from "./eastmoney";
import { parseJiweiRss } from "./jiwei";
import { parseAnnTime } from "./eastmoney-ann";
import { billboardToRawItem } from "./eastmoney-billboard";
import { aggregateBlockTrades } from "./eastmoney-blocktrade";
import {
  holderChangeToRawItem,
  shareholderChangeToRawItem,
} from "./eastmoney-holderchange";
import { forecastToRawItem } from "./eastmoney-forecast";

describe("parseEastmoneyFastNews", () => {
  it("maps items to RawNewsItem and drops entries without title/code", () => {
    const res = parseEastmoneyFastNews({
      data: {
        fastNewsList: [
          {
            title: "某公司公告",
            summary: "【某公司公告】详情内容…",
            code: "202607021234",
            showTime: "2026-07-02 15:00:00",
          },
          { title: "", summary: "无标题", code: "x" },
        ],
      },
    });
    expect(res).toHaveLength(1);
    expect(res[0]?.externalId).toBe("202607021234");
    expect(res[0]?.url).toBe(
      "https://finance.eastmoney.com/a/202607021234.html",
    );
    expect(res[0]?.title).toBe("某公司公告");
  });
});

describe("parseJiweiRss", () => {
  it("extracts items and strips HTML from the body", () => {
    const xml =
      "<rss><channel>" +
      "<item><title><![CDATA[半导体硅片上涨]]></title>" +
      "<link>https://m.laoyaoba.com/newinfo?id=1</link>" +
      "<guid>https://m.laoyaoba.com/newinfo?id=1</guid>" +
      "<description>摘要</description>" +
      "<content:encoded><![CDATA[<p>正文<b>加粗</b></p>]]></content:encoded>" +
      "<pubDate></pubDate></item>" +
      "</channel></rss>";
    const res = parseJiweiRss(xml);
    expect(res).toHaveLength(1);
    expect(res[0]?.title).toBe("半导体硅片上涨");
    expect(res[0]?.url).toBe("https://m.laoyaoba.com/newinfo?id=1");
    expect(res[0]?.content).toContain("正文");
    expect(res[0]?.content).not.toContain("<p>");
  });

  it("parses a CDATA-wrapped pubDate to the real publish time (not fetch time)", () => {
    // 集微网真实 feed 的 pubDate 是 CDATA 包裹的：<![CDATA[Thu, 23 Jul 2026 15:51:00 GMT]]>
    // 漏 cdata() 会让 new Date() 解析失败 → 兜底成 new Date()（抓取时刻）。
    const xml =
      "<rss><channel>" +
      "<item><title><![CDATA[标题]]></title>" +
      "<link>https://m.laoyaoba.com/newinfo?id=2</link>" +
      "<content:encoded><![CDATA[<p>正文</p>]]></content:encoded>" +
      "<pubDate><![CDATA[Thu, 23 Jul 2026 15:51:00 GMT]]></pubDate></item>" +
      "</channel></rss>";
    const res = parseJiweiRss(xml);
    expect(res[0]?.publishedAt.toISOString()).toBe("2026-07-23T15:51:00.000Z");
  });
});

describe("parseAnnTime (东财公告时间)", () => {
  it("prefers display_time (ms precision) over notice_date, parsing the colon-ms format as CST", () => {
    // display_time 格式毫秒前是冒号：YYYY-MM-DD HH:MM:SS:mmm，按东八区。
    // notice_date 恒为当日 00:00:00（日期精度），不能用。
    const d = parseAnnTime("2026-07-24 11:43:04:552", "2026-07-24 00:00:00");
    expect(d.toISOString()).toBe("2026-07-24T03:43:04.552Z");
  });

  it("falls back to notice_date (as CST midnight) when display_time is absent", () => {
    const d = parseAnnTime(undefined, "2026-07-24 00:00:00");
    expect(d.toISOString()).toBe("2026-07-23T16:00:00.000Z");
  });
});

describe("billboardToRawItem (龙虎榜结构化事件)", () => {
  it("templates a billboard row into a 龙虎榜 event with net-buy amount and code hints", () => {
    const item = billboardToRawItem({
      SECURITY_CODE: "002371",
      SECURITY_NAME_ABBR: "北方华创",
      TRADE_DATE: "2026-07-23 00:00:00",
      EXPLANATION: "日涨幅偏离值达7%的前五只证券",
      BILLBOARD_NET_AMT: 12500000,
    });
    expect(item).not.toBeNull();
    expect(item!.eventType).toBe("龙虎榜");
    expect(item!.title).toContain("北方华创");
    expect(item!.title).toContain("净买入1250万元");
    expect(item!.entityHints).toEqual(["北方华创", "002371"]);
    // 龙虎榜是收盘后披露 → 用交易日 18:00 CST 作发布时刻代理（10:00 UTC）
    expect(item!.publishedAt.toISOString()).toBe("2026-07-23T10:00:00.000Z");
  });

  it("labels a net-sell row and drops rows missing code/name", () => {
    const sell = billboardToRawItem({
      SECURITY_CODE: "300750",
      SECURITY_NAME_ABBR: "宁德时代",
      TRADE_DATE: "2026-07-23 00:00:00",
      BILLBOARD_NET_AMT: -8000000,
    });
    expect(sell!.title).toContain("净卖出800万元");
    expect(
      billboardToRawItem({
        SECURITY_CODE: "",
        SECURITY_NAME_ABBR: "x",
        TRADE_DATE: "2026-07-23 00:00:00",
      }),
    ).toBeNull();
  });
});

describe("aggregateBlockTrades (大宗交易按股+日聚合)", () => {
  it("aggregates multiple same-day trades into one event with amount-weighted premium", () => {
    const items = aggregateBlockTrades([
      { SECURITY_CODE: "300750", SECURITY_NAME_ABBR: "宁德时代", TRADE_DATE: "2026-07-23 00:00:00", DEAL_AMT: 10000000, PREMIUM_RATIO: -5 },
      { SECURITY_CODE: "300750", SECURITY_NAME_ABBR: "宁德时代", TRADE_DATE: "2026-07-23 00:00:00", DEAL_AMT: 30000000, PREMIUM_RATIO: -3 },
      { SECURITY_CODE: "002371", SECURITY_NAME_ABBR: "北方华创", TRADE_DATE: "2026-07-23 00:00:00", DEAL_AMT: 5000000, PREMIUM_RATIO: 2 },
    ]);
    expect(items).toHaveLength(2);
    const catl = items.find((i) => i.entityHints?.includes("300750"))!;
    expect(catl.eventType).toBe("大宗交易");
    expect(catl.title).toContain("2笔");
    expect(catl.title).toContain("4000万元"); // 1000万 + 3000万
    // 金额加权折价 = (-5*1e7 + -3*3e7)/4e7 = -3.5%
    expect(catl.title).toContain("折价3.5%");
    expect(catl.publishedAt.toISOString()).toBe("2026-07-23T10:00:00.000Z");
    const nfhc = items.find((i) => i.entityHints?.includes("002371"))!;
    expect(nfhc.title).toContain("1笔");
    expect(nfhc.title).toContain("溢价2%");
  });
});

describe("holderChangeToRawItem (董监高/股东增减持事件)", () => {
  it("templates an executive increase with person, position, shares", () => {
    const item = holderChangeToRawItem({
      SECURITY_CODE: "002371",
      SECURITY_NAME_ABBR: "北方华创",
      PERSON_NAME: "张三",
      POSITION_NAME: "董事长",
      CHANGE_SHARES: 490000,
      AVERAGE_PRICE: 765.8,
      CHANGE_DATE: "2026-07-23 00:00:00",
    });
    expect(item).not.toBeNull();
    expect(item!.eventType).toBe("增持");
    expect(item!.title).toContain("北方华创");
    expect(item!.title).toContain("董事长张三");
    expect(item!.title).toContain("增持");
    expect(item!.entityHints).toEqual(["北方华创", "002371"]);
  });

  it("labels a decrease and drops rows without code or person", () => {
    const dec = holderChangeToRawItem({
      SECURITY_CODE: "300750",
      SECURITY_NAME_ABBR: "宁德时代",
      PERSON_NAME: "李四",
      POSITION_NAME: "监事",
      CHANGE_SHARES: -7500,
      CHANGE_DATE: "2026-07-23 00:00:00",
    });
    expect(dec!.eventType).toBe("减持");
    expect(dec!.title).toContain("减持");
    expect(
      holderChangeToRawItem({ SECURITY_CODE: "", SECURITY_NAME_ABBR: "x", PERSON_NAME: "", CHANGE_SHARES: 1, CHANGE_DATE: "2026-07-23 00:00:00" }),
    ).toBeNull();
  });
});

describe("shareholderChangeToRawItem (股东增减持事件)", () => {
  it("templates a major-shareholder change with direction, rate and holding", () => {
    const item = shareholderChangeToRawItem({
      SECURITY_CODE: "603926",
      SECURITY_NAME_ABBR: "铁流股份",
      HOLDER_NAME: "杭州德萨实业集团",
      DIRECTION: "减持",
      CHANGE_RATE: 0.7117,
      HOLD_RATIO: 34.9,
      NOTICE_DATE: "2026-07-25 00:00:00",
    });
    expect(item).not.toBeNull();
    expect(item!.eventType).toBe("减持");
    expect(item!.title).toContain("铁流股份");
    expect(item!.title).toContain("杭州德萨实业集团");
    expect(item!.title).toContain("减持");
    expect(item!.entityHints).toEqual(["铁流股份", "603926"]);
  });

  it("uses absolute rate so 减持 with a signed CHANGE_RATE isn't a double-negative", () => {
    const item = shareholderChangeToRawItem({
      SECURITY_CODE: "000039",
      SECURITY_NAME_ABBR: "中集集团",
      HOLDER_NAME: "中信保诚人寿",
      DIRECTION: "减持",
      CHANGE_RATE: -2.85,
      HOLD_RATIO: 5,
      NOTICE_DATE: "2026-07-25 00:00:00",
    });
    expect(item!.title).toContain("减持2.85%");
    expect(item!.title).not.toContain("减持-2.85%");
  });

  it("drops rows without code or holder", () => {
    expect(
      shareholderChangeToRawItem({ SECURITY_CODE: "", SECURITY_NAME_ABBR: "x", HOLDER_NAME: "", DIRECTION: "增持", NOTICE_DATE: "2026-07-25 00:00:00" }),
    ).toBeNull();
  });
});

describe("forecastToRawItem (业绩预告事件)", () => {
  it("templates a forecast with type, amplitude range and reason", () => {
    const item = forecastToRawItem({
      SECURITY_CODE: "688981",
      SECURITY_NAME_ABBR: "中芯国际",
      PREDICT_TYPE: "略增",
      ADD_AMP_LOWER: 30,
      ADD_AMP_UPPER: 45,
      CHANGE_REASON_EXPLAIN: "行业景气回升",
      NOTICE_DATE: "2026-07-24 00:00:00",
      REPORT_DATE: "2026-06-30 00:00:00",
    });
    expect(item).not.toBeNull();
    expect(item!.eventType).toBe("业绩预告");
    expect(item!.title).toContain("中芯国际");
    expect(item!.title).toContain("略增");
    expect(item!.title).toContain("30");
    expect(item!.entityHints).toEqual(["中芯国际", "688981"]);
  });

  it("handles turnaround (扭亏) without amplitude and drops rows missing code", () => {
    const t = forecastToRawItem({
      SECURITY_CODE: "688825",
      SECURITY_NAME_ABBR: "长鑫科技",
      PREDICT_TYPE: "扭亏",
      NOTICE_DATE: "2026-07-24 00:00:00",
      REPORT_DATE: "2026-06-30 00:00:00",
    });
    expect(t!.title).toContain("扭亏");
    expect(
      forecastToRawItem({ SECURITY_CODE: "", SECURITY_NAME_ABBR: "x", PREDICT_TYPE: "预增", NOTICE_DATE: "2026-07-24 00:00:00", REPORT_DATE: "2026-06-30 00:00:00" }),
    ).toBeNull();
  });

  it("never stamps publishedAt in the future — clamps today's 08:00 convention to now when viewed before 08:00", () => {
    // 今天披露的预告，源只给日期；代码按 08:00 CST 约定打时间戳。
    // 但在 04:00 CST 看，08:00 尚未到来 → publishedAt 落在未来（「N 小时后发布」是非法的）。
    const now = new Date("2026-07-27T04:00:00+08:00");
    const item = forecastToRawItem(
      {
        SECURITY_CODE: "600519",
        SECURITY_NAME_ABBR: "贵州茅台",
        PREDICT_TYPE: "预增",
        NOTICE_DATE: "2026-07-27 00:00:00",
        REPORT_DATE: "2026-06-30 00:00:00",
      },
      now,
    );
    expect(item).not.toBeNull();
    expect(item!.publishedAt.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("keeps the 08:00 CST convention for past-dated forecasts (no clamping when already in the past)", () => {
    const now = new Date("2026-07-27T04:00:00+08:00");
    const item = forecastToRawItem(
      {
        SECURITY_CODE: "688981",
        SECURITY_NAME_ABBR: "中芯国际",
        PREDICT_TYPE: "略增",
        NOTICE_DATE: "2026-07-24 00:00:00",
        REPORT_DATE: "2026-06-30 00:00:00",
      },
      now,
    );
    expect(item!.publishedAt.toISOString()).toBe(
      new Date("2026-07-24T08:00:00+08:00").toISOString(),
    );
  });
});
