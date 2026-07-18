/**
 * 全站 SEO / 分享元数据的单一事实源（TDK + Open Graph + Twitter + JSON-LD）。
 * 页面级 metadata 都从这里取基座，避免每页各写一套、口径漂移。
 */
import { type Metadata } from "next";

export const SITE_URL = "https://jieniu.swaylab.ai";
export const SITE_NAME = "解牛";
export const SITE_TAGLINE = "聚焦式一手财经资讯 + 大师视角解读";

/** 首页 / 默认描述：关键词自然融入，控制在 ~110 字以内（利于摘要完整展示）。 */
export const SITE_DESCRIPTION =
  "解牛是聚焦式财经资讯与私人投研工作台：只覆盖最热门板块的核心个股，一手公告与重磅资讯第一时间触达，" +
  "配 AI 生成的投资逻辑（thesis）与大师视角解读，帮你盯住自选股「真正发生变化」的时刻，而不是每条新闻都推。";

export const SITE_KEYWORDS = [
  "财经资讯",
  "股票",
  "A股",
  "港股",
  "美股",
  "自选股",
  "投资逻辑",
  "一手资讯",
  "公司公告",
  "大师解读",
  "投研",
  "盯盘",
  "板块聚焦",
  "个股分析",
  "解牛",
];

/** 分享大图（1200×630）。相对路径 + metadataBase 会自动补成绝对地址。 */
export const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: `${SITE_NAME} · ${SITE_TAGLINE}`,
};

/**
 * Open Graph 基座。子页 generateMetadata 覆盖 title/description/type/url 等，
 * 但图片 / siteName / locale 始终带上——Next 的 openGraph 是整体覆盖而非深合并，
 * 所以子页也要走这个 helper，图片才不会丢。
 */
type OG = NonNullable<Metadata["openGraph"]>;
type TW = NonNullable<Metadata["twitter"]>;

export function openGraph(over: Record<string, unknown> = {}): OG {
  return {
    siteName: SITE_NAME,
    locale: "zh_CN",
    type: "website",
    url: SITE_URL,
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
    ...over,
  };
}

export function twitter(over: Record<string, unknown> = {}): TW {
  return {
    card: "summary_large_image",
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
    ...over,
  };
}

/** 绝对化一个站内路径，供 canonical / JSON-LD 用。 */
export const abs = (path: string) =>
  path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

/** 描述截断到搜索摘要友好长度（中文按字计）。 */
export function clip(s: string, n = 155): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

/* ---------- JSON-LD 结构化数据 ---------- */

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: "解牛财经",
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    inLanguage: "zh-CN",
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: abs("/icon.svg"),
    description: SITE_TAGLINE,
  };
}

export function newsArticleJsonLd(a: {
  id: string;
  title: string;
  summary: string;
  publishedAt: Date;
  sourceName: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: clip(a.title, 110),
    description: clip(a.summary),
    datePublished: a.publishedAt.toISOString(),
    dateModified: a.publishedAt.toISOString(),
    inLanguage: "zh-CN",
    mainEntityOfPage: { "@type": "WebPage", "@id": abs(`/news/${a.id}`) },
    image: [abs(OG_IMAGE.url)],
    author: { "@type": "Organization", name: a.sourceName },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: abs("/icon.svg") },
    },
  };
}

/** 统一渲染 JSON-LD <script>（在 server component 里直接用）。 */
export function jsonLdScript(data: object) {
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: { __html: JSON.stringify(data) },
  };
}
