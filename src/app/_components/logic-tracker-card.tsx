import type { ThesisDimension } from "~/lib/thesis";
import {
  trackDimension,
  statusBadgeClass,
  type DimSignal,
} from "~/lib/logic-tracker";
import { impactBadgeClass } from "~/lib/logic-impact";
import { relativeTime } from "~/lib/format";

export type TrackerSignal = DimSignal & { dimensionKey: string };

/**
 * 逻辑追踪器（P5-7）：把「盯这几个维度」重构成显式追踪表——
 * 每个投资命题 | 当前状态(已验证/部分验证/待验证/未验证) | 变化(增强/削弱) | 最新证据。
 * 纯规则（`logic-tracker.ts`），零 AI；配色 amber/灰、无红绿。
 */
export function LogicTracker({
  dims,
  signals,
}: {
  dims: ThesisDimension[];
  signals: TrackerSignal[];
}) {
  const byDim = new Map<string, DimSignal[]>();
  for (const s of signals) {
    const arr = byDim.get(s.dimensionKey) ?? [];
    arr.push(s);
    byDim.set(s.dimensionKey, arr);
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted">
          逻辑追踪器
        </h3>
        <span className="text-[11px] text-muted">
          每个命题验证到哪一步 · 在增强还是削弱
        </span>
      </div>
      {/* 桌面列头 */}
      <div className="hidden grid-cols-[1fr_auto_auto] gap-2 border-b border-line/60 px-3 pb-1.5 text-[11px] font-medium text-muted sm:grid">
        <span>投资命题</span>
        <span className="w-16 text-center">当前状态</span>
        <span className="w-16 text-center">变化</span>
      </div>
      <ul className="divide-y divide-line/60">
        {dims.map((d) => {
          const t = trackDimension(byDim.get(d.key) ?? []);
          return (
            <li key={d.key} className="px-1 py-2.5 sm:px-3">
              <div className="flex flex-wrap items-center gap-2 sm:grid sm:grid-cols-[1fr_auto_auto]">
                <span className="text-sm font-semibold text-ink">{d.key}</span>
                <span className="sm:w-16 sm:text-center">
                  <span className={statusBadgeClass(t.statusTone)}>
                    {t.statusLabel}
                  </span>
                </span>
                <span className="sm:w-16 sm:text-center">
                  <span className={impactBadgeClass(t.impact.tone)}>
                    {t.impact.label}
                  </span>
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                盯：{d.watch}
              </p>
              {t.latest ? (
                <p className="mt-1 text-xs leading-relaxed text-ink/85">
                  <span className="text-muted">
                    最新证据
                    {t.latest.publishedAt
                      ? ` · ${relativeTime(new Date(t.latest.publishedAt))}`
                      : ""}
                    ：
                  </span>
                  {t.latest.note}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-muted">
                  暂无触及该命题的资讯，待验证。
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
