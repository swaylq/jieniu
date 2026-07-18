import Link from "next/link";

import {
  FOLLOWUP_LABEL,
  followUpTone,
  type FollowUp,
  type TimelineItem,
} from "~/lib/event-timeline";
import { ACTION_LABEL, normalizeAction } from "~/lib/decision";
import { streamStamp } from "~/lib/format";

function actionLabel(a: string): string {
  return a === "NOTE" ? "笔记" : (ACTION_LABEL[normalizeAction(a)] ?? a);
}

function FollowUpBadge({ f }: { f: FollowUp }) {
  const tone = followUpTone(f);
  const cls =
    tone === "accent"
      ? "rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand"
      : tone === "ink"
        ? "rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink"
        : "rounded px-1.5 py-0.5 text-[10px] font-medium text-muted";
  return <span className={cls}>{FOLLOWUP_LABEL[f]}</span>;
}

/**
 * 事件时间线复盘（P5-11）：触及投资逻辑的材料动态 + 你当时的决策，按时间倒序；
 * 每条动态标「后续得到印证 / 被反转 / 尚待验证」（同维度更晚材料信号推导）。纯规则、零 AI、无红绿。
 */
export function EventTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 14);

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <div className="flex items-center gap-2">
        <span aria-hidden>🕰️</span>
        <h2 className="text-base font-bold text-ink">事件时间线复盘</h2>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        触及你逻辑的动态 + 你当时的判断，按时间倒序；「后续」= 同维度更晚的材料信号是否印证。
      </p>

      <ol className="mt-3 space-y-3 border-l border-line/70 pl-4">
        {shown.map((it, i) => (
          <li key={i} className="relative">
            <span
              className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${
                it.kind === "decision"
                  ? "bg-canvas ring-2 ring-brand"
                  : "bg-brand/50"
              }`}
              aria-hidden
            />
            {it.kind === "signal" ? (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-[11px] text-muted">
                    {streamStamp(new Date(it.at))}
                  </span>
                  <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                    {it.dimensionKey}
                  </span>
                  <FollowUpBadge f={it.followUp} />
                </div>
                <p className="mt-1 text-sm leading-relaxed text-ink/85">
                  {it.note}
                </p>
                {it.newsTitle ? (
                  it.newsId ? (
                    <Link
                      href={`/news/${it.newsId}`}
                      className="mt-0.5 line-clamp-1 text-[11px] text-muted transition-colors hover:text-brand"
                    >
                      {it.newsTitle}
                    </Link>
                  ) : (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">
                      {it.newsTitle}
                    </p>
                  )
                ) : null}
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-[11px] text-muted">
                    {streamStamp(new Date(it.at))}
                  </span>
                  <span className="rounded border border-brand/40 px-1.5 py-0.5 text-[11px] font-semibold text-brand">
                    你的判断 · {actionLabel(it.action)}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-ink/85">
                  {it.reason}
                </p>
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        不含股价反应 / 当时市场预期的定量复盘（需行情数据，暂未接入）。
      </p>
    </section>
  );
}
