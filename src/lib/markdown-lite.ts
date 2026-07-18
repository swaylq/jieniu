/**
 * 极简 markdown 解析（够用于大师解读的输出：小标题 / 要点 / 粗体）。
 * 返回结构化数据，交给 UI 用 React 节点渲染——不生成 HTML，天然防注入。
 */
export type MdBlock =
  | { type: "h1" | "h2" | "h3" | "p" | "note" | "disclaimer"; text: string }
  | { type: "ul"; items: string[] };

export function parseMarkdownLite(src: string): MdBlock[] {
  const lines = src.replace(/\r/g, "").split("\n");
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let bullets: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(" ").trim();
    if (text) {
      const type = /^【.*】$/.test(text)
        ? "note"
        : text.startsWith("——")
          ? "disclaimer"
          : "p";
      blocks.push({ type, text });
    }
    para = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push({ type: "ul", items: bullets });
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushBullets();
      continue;
    }
    // 分隔线（--- / *** / ___）：丢弃，避免在解读里渲染成字面量。
    if (/^([-*_])\1{2,}$/.test(line)) {
      flushPara();
      flushBullets();
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      flushPara();
      flushBullets();
      const level = Math.min(h[1]!.length, 3);
      const tag = (["h1", "h2", "h3"] as const)[level - 1]!;
      blocks.push({ type: tag, text: h[2]!.trim() });
      continue;
    }
    const b = /^[-•*]\s+(.+)$/.exec(line);
    if (b) {
      flushPara();
      bullets.push(b[1]!.trim());
      continue;
    }
    flushBullets();
    para.push(line);
  }
  flushPara();
  flushBullets();
  return blocks;
}

const TLDR_LABEL = /^(一句话看懂|速览|一句话摘要|一句话读懂|TL;?DR)/i;

/**
 * 从解读块里抽出「一句话看懂」TL;DR：找到首个标记小标题 + 其后紧邻的一段（要点列表或段落），
 * 交给 UI 顶部高亮成"速览卡"。找不到则返回原样（tldr=null），老缓存不受影响。
 */
export function extractTldr(blocks: MdBlock[]): {
  tldr: string[] | null;
  rest: MdBlock[];
} {
  const i = blocks.findIndex(
    (b) =>
      (b.type === "h1" || b.type === "h2" || b.type === "h3") &&
      TLDR_LABEL.test(b.text),
  );
  if (i === -1) return { tldr: null, rest: blocks };
  const next = blocks[i + 1];
  let items: string[];
  if (next?.type === "ul") items = next.items;
  else if (next?.type === "p") items = [next.text];
  else return { tldr: null, rest: blocks };
  const rest = [...blocks.slice(0, i), ...blocks.slice(i + 2)];
  return { tldr: items, rest };
}

export type InlineSpan = { text: string; bold: boolean };

/** 把 **粗体** 拆成片段（纯数据，UI 用 <strong> 渲染，不注入 HTML）。 */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last)
      spans.push({ text: text.slice(last, m.index), bold: false });
    spans.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), bold: false });
  return spans.length > 0 ? spans : [{ text, bold: false }];
}
