/** 常见 HTML 命名实体 → 字符。 */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
};

function safeCodePoint(n: number): string {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m);
}

/** 清洗正文：去 HTML 标签/实体，规整空白，但保留段落换行。 */
export function cleanText(s: string): string {
  const stripped = decodeEntities(s.replace(/<[^>]+>/g, " "));
  return stripped
    .replace(/\r/g, "")
    .replace(/[ \t　]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 清洗单行文本（标题/摘要）：在 cleanText 基础上把所有空白压成单空格。 */
export function cleanInline(s: string): string {
  return cleanText(s).replace(/\s+/g, " ").trim();
}

const SPAM =
  /扫码|关注公众号|点击查看|点击下载|下载\s*APP|二维码|开户送|【广告】|软文推广|更多精彩内容/i;
const HAS_TEXT = /[一-鿿a-zA-Z]/;

export type QualityVerdict = { ok: boolean; reason?: string };

/**
 * 质量筛查：剔除空/超短标题、无文字标题、乱码(编码坏)、广告引流。
 * 保守——只挡明显垃圾，不误伤正常资讯（宁可多留，不可错杀新闻）。
 */
export function screenQuality(n: {
  title: string;
  summary?: string;
  content?: string | null;
}): QualityVerdict {
  const title = n.title.trim();
  if (title.length < 3) return { ok: false, reason: "title-too-short" };
  if (!HAS_TEXT.test(title)) return { ok: false, reason: "title-no-text" };
  const blob = `${title}\n${n.summary ?? ""}`;
  if (blob.includes("�")) return { ok: false, reason: "garbled" };
  if (SPAM.test(blob)) return { ok: false, reason: "spam" };
  return { ok: true };
}
