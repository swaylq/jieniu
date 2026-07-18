import type { RawNewsItem, SourceDef } from "../types";
import { toValidDate } from "../../../lib/format";

const API =
  "https://api.wallstreetcn.com/apiv1/content/lives?channel=a-stock-channel&client=pc&limit=30";

type WsItem = {
  id: number;
  title?: string;
  content_text?: string;
  content?: string;
  display_time: number;
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

/** 华尔街见闻 A 股 7×24 快讯（开放 JSON，每条明文 content_text）。媒体级。 */
export const wallstreetcnAStock: SourceDef = {
  key: "wallstreetcn-astock",
  name: "华尔街见闻·A股",
  tier: "MEDIA",
  kind: "json-api",
  async fetch(): Promise<RawNewsItem[]> {
    const res = await fetch(API, {
      headers: { "User-Agent": "Mozilla/5.0 (jieniu-ingest)" },
    });
    if (!res.ok) throw new Error(`wallstreetcn ${res.status}`);
    const json = (await res.json()) as { data?: { items?: WsItem[] } };
    const items = json.data?.items ?? [];

    return items
      .map((it): RawNewsItem | null => {
        const text = (it.content_text ?? stripHtml(it.content ?? "")).trim();
        const trimmedTitle = it.title?.trim() ?? "";
        const firstLine = text.split("\n")[0] ?? "";
        const title = (trimmedTitle.length > 0 ? trimmedTitle : firstLine).slice(
          0,
          120,
        );
        if (title.length === 0) return null;
        return {
          externalId: String(it.id),
          title,
          url: `https://wallstreetcn.com/livenews/${it.id}`,
          summary: text.slice(0, 500),
          content: text,
          publishedAt: toValidDate(it.display_time * 1000),
        };
      })
      .filter((x): x is RawNewsItem => x !== null);
  },
};
