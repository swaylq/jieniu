import {
  parseMarkdownLite,
  parseInline,
  extractTldr,
} from "~/lib/markdown-lite";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) =>
        s.bold ? (
          <strong key={i} className="font-semibold text-ink">
            {s.text}
          </strong>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/**
 * 结构化渲染大师解读的 markdown-lite：
 * 顶部「一句话看懂」速览卡 / persona 小注 / 小节标题(品牌竖条) / 要点(圆点) / 粗体 /
 * 底部标准化免责块。纯 React 节点，无外部依赖、不注入 HTML。
 */
export function InterpretationBody({ md }: { md: string }) {
  const { tldr, rest } = extractTldr(parseMarkdownLite(md));
  return (
    <div className="space-y-2.5 leading-relaxed text-ink/90">
      {tldr && (
        <div className="rounded-lg border border-brand/30 bg-brand/[0.06] px-3 py-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            一句话看懂
          </p>
          <ul className="space-y-1">
            {tldr.map((it, j) => (
              <li key={j} className="flex gap-2">
                <span
                  className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand/60"
                  aria-hidden
                />
                <span>
                  <Inline text={it} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rest.map((b, i) => {
        if (b.type === "ul") {
          return (
            <ul key={i} className="space-y-1.5">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-2">
                  <span
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand/60"
                    aria-hidden
                  />
                  <span>
                    <Inline text={it} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === "note") {
          return (
            <p
              key={i}
              className="rounded bg-surface px-2 py-1 text-xs text-muted"
            >
              {b.text}
            </p>
          );
        }
        if (b.type === "disclaimer") {
          return (
            <p
              key={i}
              className="mt-3 flex gap-1.5 rounded-md border border-line/70 bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-muted"
            >
              <span aria-hidden>ⓘ</span>
              <span>{b.text.replace(/^——\s*/, "")}</span>
            </p>
          );
        }
        if (b.type === "h1") {
          return (
            <p key={i} className="text-xs font-medium text-muted">
              <Inline text={b.text} />
            </p>
          );
        }
        if (b.type === "h2" || b.type === "h3") {
          return (
            <h4
              key={i}
              className="mt-3 flex items-center gap-2 font-semibold text-ink first:mt-0"
            >
              <span
                className="h-3.5 w-1 shrink-0 rounded-full bg-brand"
                aria-hidden
              />
              <Inline text={b.text} />
            </h4>
          );
        }
        return (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        );
      })}
    </div>
  );
}
