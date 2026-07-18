import Link from "next/link";

import {
  eventTypeLabel,
  sourceTierLabel,
  streamStamp,
  summaryIsRedundant,
  tierBadgeClass,
} from "~/lib/format";
import { IMPORTANT_THRESHOLD } from "~/lib/importance";
import type { SourceTier } from "../../../generated/prisma";

export type StreamItem = {
  id: string;
  title: string;
  url: string;
  summary: string;
  tier: SourceTier;
  importance: number;
  eventType: string | null;
  publishedAt: Date;
  source: { name: string };
};

/**
 * 一手时间轴（灵感：富途快讯时间轴 + 财联社加红）。
 * 左侧竖轴 + 彩色时间戳锚点；重磅(importance≥阈值)用琥珀强调（时间戳变琥珀 + 「重磅」角标 + 实心锚点）。
 * 点标题进详情页（含大师共识罗盘）。琥珀=重磅标记，不涉红绿（红绿只留给真实涨跌）。
 */
export function NewsTimeline({ items }: { items: StreamItem[] }) {
  return (
    <ol className="relative ml-1 border-l border-line">
      {items.map((n) => {
        const hot = n.importance >= IMPORTANT_THRESHOLD;
        const published = new Date(n.publishedAt);
        const showSummary = !summaryIsRedundant(n.title, n.summary);
        return (
          <li key={n.id} className="relative py-2.5 pl-4 pr-1">
            <span
              className={`absolute -left-[5px] top-3.5 h-2.5 w-2.5 rounded-full ring-2 ring-canvas ${
                hot ? "bg-brand" : "bg-line"
              }`}
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <time
                dateTime={published.toISOString()}
                title={published.toLocaleString("zh-CN", { hour12: false })}
                className={`tabular font-semibold ${
                  hot ? "text-brand" : "text-muted"
                }`}
              >
                {streamStamp(published)}
              </time>
              {hot && (
                <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                  重磅
                </span>
              )}
              <span className={tierBadgeClass(n.tier)}>
                {sourceTierLabel(n.tier)}
              </span>
              {n.eventType && (
                <span className="text-muted">{eventTypeLabel(n.eventType)}</span>
              )}
              <span className="truncate text-muted">{n.source.name}</span>
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto shrink-0 text-muted transition-colors hover:text-brand"
                aria-label="查看原文"
              >
                原文 ↗
              </a>
            </div>
            <Link
              href={`/news/${n.id}`}
              className="mt-1 block text-sm font-medium leading-snug text-ink transition-colors hover:text-brand"
            >
              {n.title}
            </Link>
            {showSummary && (
              <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted">
                {n.summary}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
