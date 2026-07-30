import { describe, it, expect, vi, beforeEach } from "vitest";

// 死壳/空页（0 资讯的退市壳、历史死码）不该进 sitemap，否则把爬虫指向薄内容页（QA loop run 12/13 backlog，
// run 44 sway 授权执行）。这里 mock db，断言 entity 查询带 `where: { news: { some: {} } }` 过滤。
const entityFindMany = vi.fn<(a: unknown) => Promise<unknown>>();
const newsFindMany = vi.fn<(a: unknown) => Promise<unknown>>();
vi.mock("~/server/db", () => ({
  db: {
    entity: { findMany: (a: unknown) => entityFindMany(a) },
    newsItem: { findMany: (a: unknown) => newsFindMany(a) },
  },
}));
vi.mock("~/lib/seo", () => ({ SITE_URL: "https://jieniu.test" }));

import sitemap from "./sitemap";

beforeEach(() => {
  entityFindMany
    .mockReset()
    .mockResolvedValue([{ id: "e1", createdAt: new Date("2026-07-01T00:00:00Z") }]);
  newsFindMany
    .mockReset()
    .mockResolvedValue([{ id: "n1", publishedAt: new Date("2026-07-02T00:00:00Z") }]);
});

describe("sitemap 只收有资讯的实体", () => {
  it("entity 查询带 where news.some（排除 0 资讯的死壳/空页）", async () => {
    await sitemap();
    const arg = entityFindMany.mock.calls[0]?.[0] as { where?: unknown };
    expect(arg.where).toEqual({ news: { some: {} } });
  });

  it("把有资讯的实体与新闻都放进 sitemap", async () => {
    const map = await sitemap();
    const urls = map.map((m) => m.url);
    expect(urls).toContain("https://jieniu.test/entity/e1");
    expect(urls).toContain("https://jieniu.test/news/n1");
  });
});
