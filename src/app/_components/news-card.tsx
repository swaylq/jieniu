import Link from "next/link";

import {
  relativeTime,
  sourceTierLabel,
  summaryIsRedundant,
  tierBadgeClass,
} from "~/lib/format";
import { classifyNovelty } from "~/lib/novelty";
import { filingExcerpt, excerptIsEmpty } from "~/lib/filing-excerpt";
import type { SourceTier } from "../../../generated/prisma";
import { InterpretationPanel } from "./interpretation-panel";
import { NewsActions } from "./news-actions";

export type NewsCardItem = {
  id: string;
  title: string;
  url: string;
  summary: string;
  brief?: string | null; // 事件摘要（一次生成）：一句话说清发生了什么、为什么值得看
  tier: SourceTier;
  publishedAt: Date;
  source: { name: string };
  event?: { count: number } | null; // 同事件多篇（P4-7），可选
  burstCount?: number; // 同日一手公告轰炸折叠后、当日其余份数（run10），可选
};

/**
 * 单条新闻卡片：来源等级徽标 + 来源 + 相对时间 + 标题(→详情页) + 摘要 + AI 解读。首页/feed/实体页/收藏共用。
 *
 * 本组件根元素就是 `<li>`，调用方必须直接放进 `<ul>`，**不要再包一层 `<li>`/`<div>`**——
 * `<li>` 嵌 `<li>` 是非法 HTML，浏览器会强行闭合外层并把卡片重新挂到上层容器，
 * 导致卡片逃出内容列、撑满整宽（提醒中心曾因此炸掉）。未读高亮走 `unread` 参数。
 */
export function NewsCard({
  n,
  unread = false,
}: {
  n: NewsCardItem;
  unread?: boolean;
}) {
  const published = new Date(n.publishedAt);
  // 卡片摘录：库里的 summary 其实是正文前 128 字截断，而公告开头恒定是法定套话
  // （证券代码/公告编号/公司名/「保证…承担法律责任」），导致卡片看着满、信息量为零。
  // 这里用纯规则剥掉样板取「必要摘录」，剥完没实质内容就干脆不显示（宁缺毋滥）。
  const excerpt = filingExcerpt(n.title, n.summary);
  const showSummary =
    !summaryIsRedundant(n.title, n.summary) && !excerptIsEmpty(excerpt);
  // 新信息程度（省 token 纯规则）：由来源等级 + 同事件文章数推导，帮用户略过重复/跟进报道
  const nov = classifyNovelty({ tier: n.tier, clusterCount: n.event?.count });
  const novText =
    n.event && n.event.count > 1
      ? `${nov.label} · ${n.event.count} 篇`
      : nov.label;

  return (
    <li
      className={`bg-surface rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md ${
        unread ? "border-brand/40 ring-brand/40 ring-1" : "border-line/70"
      }`}
    >
      <div className="text-muted mb-2.5 flex items-center gap-2 text-xs">
        <span className={tierBadgeClass(n.tier)}>
          {sourceTierLabel(n.tier)}
        </span>
        <span>{n.source.name}</span>
        <span aria-hidden>·</span>
        <time
          dateTime={published.toISOString()}
          title={published.toLocaleString("zh-CN", { hour12: false })}
          className="tabular"
        >
          {relativeTime(published)}
        </time>
        {unread ? (
          <span
            className="bg-brand/10 text-brand rounded-full px-2 py-0.5 text-[11px] font-medium"
            aria-label="未读"
          >
            新
          </span>
        ) : null}
        {/* 只给「低新信息」项打标（跟进/媒体/评论），让一手原始信息自然凸显、不冗余 */}
        {nov.tone === "weak" ? (
          <span
            title={nov.hint}
            className="border-line text-muted rounded border px-1.5 py-0.5 text-[11px] font-medium"
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
            className="text-muted hover:text-brand shrink-0 transition-colors"
            aria-label="查看原文"
          >
            原文 ↗
          </a>
        </span>
      </div>
      <Link
        href={`/news/${n.id}`}
        className="text-ink hover:text-brand block text-[15px] leading-snug font-semibold text-balance transition-colors"
      >
        {n.title}
      </Link>
      {/* 有事件摘要就优先显示它（一句话说清「发生了什么+为什么值得看」），
          原文摘录降为次级；没有摘要时摘录仍是主角。 */}
      {n.brief ? (
        <p className="text-ink/90 mt-2 text-sm leading-relaxed">{n.brief}</p>
      ) : null}
      {showSummary && (
        <p
          className={`text-muted mt-2 line-clamp-2 leading-relaxed ${
            n.brief ? "text-xs" : "text-sm"
          }`}
        >
          {excerpt}
        </p>
      )}
      {n.burstCount && n.burstCount > 0 ? (
        <p className="text-muted mt-2 text-xs">
          同日另有 {n.burstCount} 份公告（同一事件的程序性文件，已折叠）
        </p>
      ) : null}
      <InterpretationPanel newsId={n.id} title={n.title} summary={n.summary} />
    </li>
  );
}
