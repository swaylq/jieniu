import { describe, it, expect } from "vitest";
import { isAllowedFetchUrl } from "./enrich";

describe("isAllowedFetchUrl — enrich SSRF 纵深防御", () => {
  it("允许白名单资讯域（巨潮 PDF / 东财公告详情页）", () => {
    expect(
      isAllowedFetchUrl(
        "https://data.eastmoney.com/notices/detail/300750/123456789.html",
      ),
    ).toBe(true);
    expect(
      isAllowedFetchUrl(
        "http://static.cninfo.com.cn/new/fulltextAnnouncement/abc.PDF",
      ),
    ).toBe(true);
  });

  it("拒绝白名单之外的 host", () => {
    expect(isAllowedFetchUrl("https://evil.example.com/x.pdf")).toBe(false);
    expect(
      isAllowedFetchUrl("http://example.com/notices/detail/1/a.html"),
    ).toBe(false);
  });

  it("拒绝内网/回环/链路本地与云元数据端点", () => {
    expect(isAllowedFetchUrl("http://127.0.0.1/x.pdf")).toBe(false);
    expect(isAllowedFetchUrl("http://10.0.0.5/x.pdf")).toBe(false);
    expect(isAllowedFetchUrl("http://192.168.1.1/x.pdf")).toBe(false);
    expect(isAllowedFetchUrl("http://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
    expect(isAllowedFetchUrl("http://[::1]/x.pdf")).toBe(false);
  });

  it("拒绝非法 URL 与非 http(s) 协议", () => {
    expect(isAllowedFetchUrl("not a url")).toBe(false);
    expect(isAllowedFetchUrl("ftp://static.cninfo.com.cn/x.pdf")).toBe(false);
    expect(isAllowedFetchUrl("file:///etc/passwd")).toBe(false);
  });
});
