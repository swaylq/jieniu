import { type MetadataRoute } from "next";

import { db } from "~/server/db";
import { SITE_URL } from "~/lib/seo";

// 站点内容随抓取实时变化，按请求生成（与全站 force-dynamic 一致，不在 build 期打 DB）。
export const dynamic = "force-dynamic";

// 单个 sitemap 上限 50k URL；新闻按最新截取，实体全量。
const NEWS_LIMIT = 5000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [entities, news] = await Promise.all([
    db.entity.findMany({ select: { id: true, createdAt: true } }),
    db.newsItem.findMany({
      select: { id: true, publishedAt: true },
      orderBy: { publishedAt: "desc" },
      take: NEWS_LIMIT,
    }),
  ]);

  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/feed`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/discover`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  const entityRoutes: MetadataRoute.Sitemap = entities.map((e) => ({
    url: `${SITE_URL}/entity/${e.id}`,
    lastModified: e.createdAt,
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));

  const newsRoutes: MetadataRoute.Sitemap = news.map((n) => ({
    url: `${SITE_URL}/news/${n.id}`,
    lastModified: n.publishedAt,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...entityRoutes, ...newsRoutes];
}
