import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NewsTimeline, type StreamItem } from "./news-timeline";

const items: StreamItem[] = [
  {
    id: "a",
    title: "某公司拟收购某锂矿控股权",
    url: "https://example.com/a",
    summary: "巩固上游资源",
    tier: "PRIMARY",
    importance: 80,
    eventType: "收购",
    publishedAt: new Date("2026-07-04T09:07:00"),
    source: { name: "东方财富·公告" },
  },
  {
    id: "b",
    title: "普通快讯一条",
    url: "https://example.com/b",
    summary: "普通快讯一条",
    tier: "MEDIA",
    importance: 30,
    eventType: null,
    publishedAt: new Date("2026-07-04T08:00:00"),
    source: { name: "华尔街见闻" },
  },
];

const html = renderToStaticMarkup(<NewsTimeline items={items} />);

describe("NewsTimeline", () => {
  it("links each entry title to its detail page", () => {
    expect(html).toContain('href="/news/a"');
    expect(html).toContain('href="/news/b"');
  });

  it("marks a 重磅 (high-importance) entry with an amber accent", () => {
    expect(html).toContain("重磅");
    expect(html).toContain("text-brand");
    expect(html).toContain("收购"); // eventType label
  });

  it("shows source and a non-redundant summary only", () => {
    expect(html).toContain("东方财富·公告");
    expect(html).toContain("巩固上游资源");
    // b's summary equals its title → redundant → not rendered twice
    expect(html.match(/普通快讯一条/g)?.length).toBe(1);
  });

  it("never uses the up/down (price) color tokens for the 重磅 marker", () => {
    expect(html).not.toContain("text-up");
    expect(html).not.toContain("text-down");
    expect(html).not.toContain("bg-up");
    expect(html).not.toContain("bg-down");
  });
});
