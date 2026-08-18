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
import { HoverPrefetchLink } from "./hover-prefetch-link";
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
  reprintCount?: number; // 媒体转载折叠后、被折掉的同稿份数（见 lib/reprint.ts），可选
  mentionOnly?: boolean; // 只是被正文提到、主体是别家（见 lib/news-subject 的 isFeedOwnItem），可选
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
      {/* meta 行在移动端会放不下（实测 390px 屏：自然宽 ~405px，可用 326px）。原来是不换行的单行
          flex，于是每个徽标各自被压扁、在字之间折行——「媒体」竖成两个字、「东方财富·个股资讯」
          断成两行（sway 2026-08-08 截图）。改成：每块自己绝不折行（`shrink-0 whitespace-nowrap`），
          放不下就整块换行（`flex-wrap`）。桌面照旧一行，小屏是「元数据一行 + 操作右对齐一行」。 */}
      <div className="text-muted mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className={`${tierBadgeClass(n.tier)} shrink-0 whitespace-nowrap`}>
          {sourceTierLabel(n.tier)}
        </span>
        {/* 来源名是这行里唯一允许被截断的：长到一行装不下时省略号，别把两个字劈开 */}
        <span className="min-w-0 truncate" title={n.source.name}>
          {n.source.name}
        </span>
        <span aria-hidden className="shrink-0">
          ·
        </span>
        <time
          dateTime={published.toISOString()}
          title={published.toLocaleString("zh-CN", { hour12: false })}
          className="tabular shrink-0 whitespace-nowrap"
        >
          {relativeTime(published)}
        </time>
        {unread ? (
          <span
            className="bg-brand/10 text-brand shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
            aria-label="未读"
          >
            新
          </span>
        ) : null}
        {/* 只给「低新信息」项打标（跟进/媒体/评论），让一手原始信息自然凸显、不冗余 */}
        {nov.tone === "weak" ? (
          <span
            title={nov.hint}
            className="border-line text-muted shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
          >
            {novText}
          </span>
        ) : null}
        {/* 「仅提及」：标题没点到这家公司——多半是别人家的事，正文里把它列成客户/同行提了一句。
            国盾量子页上那一屏频准激光 IPO 报道就是这一类（sway 2026-08-18）。不删只标：
            产业链消息有时正是要看的，但得让人一眼看出「这条主角不是它」。 */}
        {n.mentionOnly ? (
          <span
            title="标题没点到这家公司——多半是别家的事，正文里顺带提了它一句"
            className="border-line text-muted shrink-0 rounded border border-dashed px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
          >
            仅提及
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <NewsActions id={n.id} title={n.title} compact />
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
      {/* 悬停才预取详情页：一屏可能挂二十来张卡，进页面就全量预取不划算；但不预取的话点下去要
          现付一次隧道往返（实测公网 344–677ms）。见 `hover-prefetch-link.tsx`。 */}
      <HoverPrefetchLink
        href={`/news/${n.id}`}
        className="text-ink hover:text-brand block text-[15px] leading-snug font-semibold text-balance transition-colors"
      >
        {n.title}
      </HoverPrefetchLink>
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
          同日另有 {n.burstCount} 份公告，多为同一事件的程序性文件，已折叠
        </p>
      ) : null}
      {n.reprintCount && n.reprintCount > 0 ? (
        <p className="text-muted mt-2 text-xs">
          另有 {n.reprintCount} 条同内容报道（各家媒体转发同一篇稿），已折叠
        </p>
      ) : null}
      <InterpretationPanel newsId={n.id} title={n.title} summary={n.summary} />
    </li>
  );
}
