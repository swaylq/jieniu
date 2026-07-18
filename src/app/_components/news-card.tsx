import Link from "next/link";

import {
  relativeTime,
  sourceTierLabel,
  summaryIsRedundant,
  tierBadgeClass,
} from "~/lib/format";
import { classifyNovelty } from "~/lib/novelty";
import type { SourceTier } from "../../../generated/prisma";
import { InterpretationPanel } from "./interpretation-panel";
import { NewsActions } from "./news-actions";

export type NewsCardItem = {
  id: string;
  title: string;
  url: string;
  summary: string;
  tier: SourceTier;
  publishedAt: Date;
  source: { name: string };
  event?: { count: number } | null; // 同事件多篇（P4-7），可选
  burstCount?: number; // 同日一手公告轰炸折叠后、当日其余份数（run10），可选
};

/** 单条新闻卡片：来源等级徽标 + 来源 + 相对时间 + 标题(→详情页) + 摘要 + AI 解读。首页/feed/实体页/收藏共用。 */
export function NewsCard({ n }: { n: NewsCardItem }) {
  const published = new Date(n.publishedAt);
  const showSummary = !summaryIsRedundant(n.title, n.summary);
  // 新信息程度（省 token 纯规则）：由来源等级 + 同事件文章数推导，帮用户略过重复/跟进报道
  const nov = classifyNovelty({ tier: n.tier, clusterCount: n.event?.count });
  const novText =
    n.event && n.event.count > 1 ? `${nov.label} · ${n.event.count} 篇` : nov.label;

  return (
    <li className="rounded-2xl border border-line/70 bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-2.5 flex items-center gap-2 text-xs text-muted">
        <span className={tierBadgeClass(n.tier)}>{sourceTierLabel(n.tier)}</span>
        <span>{n.source.name}</span>
        <span aria-hidden>·</span>
        <time
          dateTime={published.toISOString()}
          title={published.toLocaleString("zh-CN", { hour12: false })}
          className="tabular"
        >
          {relativeTime(published)}
        </time>
        {/* 只给「低新信息」项打标（跟进/媒体/评论），让一手原始信息自然凸显、不冗余 */}
        {nov.tone === "weak" ? (
          <span
            title={nov.hint}
            className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-muted"
          >
            {novText}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <NewsActions title={n.title} compact />
          <a
            href={n.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-muted transition-colors hover:text-brand"
            aria-label="查看原文"
          >
            原文 ↗
          </a>
        </span>
      </div>
      <Link
        href={`/news/${n.id}`}
        className="block text-balance text-[15px] font-semibold leading-snug text-ink transition-colors hover:text-brand"
      >
        {n.title}
      </Link>
      {showSummary && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">
          {n.summary}
        </p>
      )}
      {n.burstCount && n.burstCount > 0 ? (
        <p className="mt-2 text-xs text-muted">
          同日另有 {n.burstCount} 份公告（同一事件的程序性文件，已折叠）
        </p>
      ) : null}
      <InterpretationPanel newsId={n.id} title={n.title} summary={n.summary} />
    </li>
  );
}
