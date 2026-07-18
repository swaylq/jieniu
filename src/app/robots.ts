import { type MetadataRoute } from "next";

import { SITE_URL } from "~/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // 用户私有 / 无 SEO 价值的路由不放进索引。
      disallow: [
        "/api/",
        "/settings",
        "/profile",
        "/notifications",
        "/review",
        "/onboarding",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
