import Link from "next/link";

import { DIM_STATE_LABEL, type DimState } from "~/lib/dimension-state";
import { alertReason } from "~/lib/alert-protocol";
import { notificationUnread, streamStamp } from "~/lib/format";
import { AlertReviewButtons } from "./alert-review-buttons";

export type ThesisAlertItem = {
  id: string;
  entityId: string;
  entityName: string;
  dimensionKey: string;
  fromState: string;
  toState: string;
  note: string;
  newsId: string | null;
  newsTitle: string;
  crossedAt: Date;
  createdAt: Date;
  priority: boolean;
  acknowledged: boolean;
  reviewAction: string | null;
};

function stateLabel(s: string): string {
  return DIM_STATE_LABEL[s as DimState] ?? s;
}

/** thesis 维度状态跨越列表（P4-8，升级 P3-6）：只在逻辑方向真的变了时提醒。颜色只用 amber/灰。 */
export function ThesisAlerts({
  alerts,
  seenAt,
}: {
  alerts: ThesisAlertItem[];
  seenAt: Date | null;
}) {
  if (alerts.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden>🎯</span>
        <h2 className="text-base font-bold text-ink">投资逻辑异动</h2>
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
          {alerts.length}
        </span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        某个维度的状态发生了跨越（如 中性 → 偏风险）才提醒——只在逻辑方向真的变了时打扰你。
      </p>
      <ul className="space-y-3">
        {alerts.map((a) => {
          const unread = notificationUnread(a.createdAt, seenAt);
          const toBullish = a.toState === "bullish";
          return (
            <li
              key={a.id}
              className={`relative rounded-xl border bg-surface p-4 transition-opacity ${
                a.acknowledged
                  ? "border-line opacity-60"
                  : unread
                    ? "border-brand/30 ring-1 ring-brand/40"
                    : "border-line"
              }`}
            >
              {unread && !a.acknowledged ? (
                <span
                  className="absolute right-3 top-3 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand"
                  aria-label="未读"
                >
                  新
                </span>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-8">
                <Link
                  href={`/entity/${a.entityId}`}
                  className="font-semibold text-ink transition-colors hover:text-brand"
                >
                  {a.entityName}
                </Link>
                {/* 维度徽标每条都有 → 中性；琥珀留给未读「新」标记与卡片高亮环 */}
                <span className="rounded bg-line/60 px-1.5 py-0.5 text-[11px] font-medium text-muted">
                  {a.priority ? "★ " : ""}
                  {a.dimensionKey}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-muted">
                  {stateLabel(a.fromState)}
                  <span aria-hidden>→</span>
                  <b className={toBullish ? "text-brand" : "text-ink"}>
                    {stateLabel(a.toState)}
                  </b>
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink/85">{a.note}</p>
              {/* 从「有新闻」到「有变化」：带理由的行动提示（hedged、非指令，P5-8） */}
              <div className="mt-2 rounded-lg border border-line/70 bg-canvas px-3 py-2">
                <p className="mb-0.5 text-[11px] font-semibold text-muted">
                  需要复核什么
                </p>
                <p className="text-xs leading-relaxed text-ink/80">
                  {alertReason({ toState: a.toState, dimensionKey: a.dimensionKey })}
                </p>
              </div>
              {a.newsTitle ? (
                a.newsId ? (
                  <Link
                    href={`/news/${a.newsId}`}
                    className="mt-1.5 flex items-baseline gap-2 text-xs text-muted transition-colors hover:text-brand"
                  >
                    <span className="tabular shrink-0">{streamStamp(a.crossedAt)}</span>
                    <span className="line-clamp-1">{a.newsTitle}</span>
                  </Link>
                ) : (
                  <p className="mt-1.5 flex items-baseline gap-2 text-xs text-muted">
                    <span className="tabular shrink-0">{streamStamp(a.crossedAt)}</span>
                    <span className="line-clamp-1">{a.newsTitle}</span>
                  </p>
                )
              ) : null}
              {a.acknowledged ? (
                <p className="mt-2 text-[11px] text-muted">
                  ✓ {a.reviewAction === "dismissed" ? "已标记不相关" : "已复核"}
                </p>
              ) : (
                <AlertReviewButtons
                  entityId={a.entityId}
                  dimensionKey={a.dimensionKey}
                  crossedAt={a.crossedAt}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
