import { describe, it, expect } from "vitest";

import { parseEastmoneyFastNews } from "./eastmoney";
import { parseJiweiRss } from "./jiwei";

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
});
