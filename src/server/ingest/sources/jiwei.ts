import type { RawNewsItem, SourceDef } from "../types";

const RSS = "https://www.ijiwei.com/api/rss/hbb";

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return (m?.[1] ?? "").trim();
}
function cdata(s: string): string {
  return s
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 解析集微网 RSS（全文 content:encoded），纯函数便于单测。 */
export function parseJiweiRss(xml: string): RawNewsItem[] {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return blocks
    .map((block): RawNewsItem | null => {
      const title = cdata(tag(block, "title"));
      const linkTag = cdata(tag(block, "link"));
      const guid = cdata(tag(block, "guid"));
      const link = linkTag !== "" ? linkTag : guid;
      if (title === "" || link === "") return null;
      const encoded = cdata(tag(block, "content:encoded"));
      const desc = cdata(tag(block, "description"));
      const bodyHtml = encoded !== "" ? encoded : desc;
      const body = stripHtml(bodyHtml);
      const pub = tag(block, "pubDate");
      const d = pub !== "" ? new Date(pub) : new Date();
      return {
        externalId: link,
        title: title.slice(0, 150),
        url: link,
        summary: (body !== "" ? body : title).slice(0, 500),
        content: body !== "" ? body : undefined,
        publishedAt: isNaN(d.getTime()) ? new Date() : d,
      };
    })
    .filter((x): x is RawNewsItem => x !== null);
}

/** 集微网/爱集微 半导体行业原创报道（全文 RSS）。媒体级（原创一手）。 */
export const jiweiSemi: SourceDef = {
  key: "jiwei-hbb",
  name: "集微网",
  tier: "MEDIA",
  kind: "rss",
  async fetch(): Promise<RawNewsItem[]> {
    const res = await fetch(RSS, {
      headers: { "User-Agent": "Mozilla/5.0 (jieniu-ingest)" },
    });
    if (!res.ok) throw new Error(`jiwei ${res.status}`);
    const xml = await res.text();
    return parseJiweiRss(xml);
  },
};
