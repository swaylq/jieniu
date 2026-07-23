"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { eventTypeLabel, relativeTime } from "~/lib/format";

export type DigestItem = {
  id: string;
  title: string;
  importance: number;
  eventType: string | null;
  publishedAt: Date;
  macro: boolean;
  source: { name: string };
};

/** 简报详略分层（P5-3，答 ChatGPT「不要默认无限铺开」）：30 秒=只标题 Top3；3 分钟=标题+来源 Top6；深度=全部。 */
type Depth = "30s" | "3min" | "deep";
const DEPTH_COUNT: Record<Depth, number> = { "30s": 3, "3min": 6, deep: Infinity };
const DEPTH_TABS: { key: Depth; label: string }[] = [
  { key: "30s", label: "30 秒" },
  { key: "3min", label: "3 分钟" },
  { key: "deep", label: "深度" },
];

function DigestRow({
  n,
  index,
  minimal,
}: {
  n: DigestItem;
  index: number;
  minimal: boolean;
}) {
  return (
    <li className="flex gap-3">
      {/* 序号是序数信息、每条都有，不是焦点：走静默色，别和真正的强调抢琥珀。见 DESIGN.md */}
      <span className="tabular mt-0.5 w-4 shrink-0 text-right text-sm font-bold text-faint">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={`/news/${n.id}`}
          className="line-clamp-2 text-sm font-medium leading-snug text-ink transition-colors hover:text-brand"
        >
          {n.title}
        </Link>
        {minimal ? null : (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {n.macro ? (
              <span className="rounded bg-line/60 px-1.5 py-0.5 font-medium text-muted">
                宏观
              </span>
            ) : n.eventType ? (
              <span className="rounded bg-line/60 px-1.5 py-0.5 font-medium text-muted">
                {eventTypeLabel(n.eventType)}
              </span>
            ) : null}
            <span>{n.source.name}</span>
            <span aria-hidden>·</span>
            <span>{relativeTime(new Date(n.publishedAt))}</span>
          </div>
        )}
      </div>
    </li>
  );
}

function SubLabel({ children }: { children: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-brand">
      <span className="h-3 w-1 rounded-full bg-brand" aria-hidden />
      {children}
    </div>
  );
}

/**
 * 解牛早报卡：近 24 小时「头条速览」，可切 30 秒 / 3 分钟 / 深度（P5-3）。登录且有自选股时顶部先放
 * 「你的自选股」段，其下「市场」段（ZF-2）。市场段已剔除退市/风险警示等晦气项并抬升宏观（ZF-1）。没料时不渲染。
 */
export function DailyDigest({
  personal = [],
  market,
}: {
  personal?: DigestItem[];
  market: DigestItem[];
}) {
  const [depth, setDepth] = useState<Depth>("3min");
  useEffect(() => {
    try {
      const v = localStorage.getItem("digestDepth");
      if (v === "30s" || v === "3min" || v === "deep") setDepth(v);
    } catch {}
  }, []);
  const choose = (d: Depth) => {
    setDepth(d);
    try {
      localStorage.setItem("digestDepth", d);
    } catch {}
  };

  if (personal.length === 0 && market.length === 0) return null;
  const hasBoth = personal.length > 0 && market.length > 0;
  const cap = DEPTH_COUNT[depth];
  const p = personal.slice(0, cap);
  const m = market.slice(0, cap);
  const minimal = depth === "30s";

  return (
    <section className="overflow-hidden rounded-2xl border border-brand/30 bg-brand/[0.06] p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            📰
          </span>
          <h2 className="text-base font-bold text-ink">解牛早报</h2>
        </div>
        <div
          role="tablist"
          aria-label="简报详略"
          className="flex rounded-full border border-brand/30 bg-surface p-0.5"
        >
          {DEPTH_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={depth === t.key}
              onClick={() => choose(t.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                depth === t.key
                  ? "bg-brand text-white"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-brand">
        近 24 小时 · 重磅 {p.length + m.length} 条
        {depth === "deep" ? "（全部）" : ""}
      </p>

      {p.length > 0 ? (
        <div className="mt-3">
          {hasBoth ? <SubLabel>你的自选股</SubLabel> : null}
          <ol className="space-y-2.5">
            {p.map((n, i) => (
              <DigestRow key={n.id} n={n} index={i + 1} minimal={minimal} />
            ))}
          </ol>
        </div>
      ) : null}

      {m.length > 0 ? (
        <div className={hasBoth ? "mt-4 border-t border-brand/15 pt-3.5" : "mt-3"}>
          {hasBoth ? <SubLabel>市场</SubLabel> : null}
          <ol className="space-y-2.5">
            {m.map((n, i) => (
              <DigestRow key={n.id} n={n} index={i + 1} minimal={minimal} />
            ))}
          </ol>
        </div>
      ) : null}

      <p className="mt-3.5 text-[11px] leading-relaxed text-muted">
        仅聚合已发生的一手 / 重磅资讯，非投资建议、不预测涨跌。
      </p>
    </section>
  );
}
