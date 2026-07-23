import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { type Metadata } from "next";

import { api } from "~/trpc/server";
import {
  abs,
  clip,
  openGraph,
  twitter,
  newsArticleJsonLd,
  jsonLdScript,
} from "~/lib/seo";
import { auth } from "~/server/auth";
import {
  relativeTime,
  sourceTierLabel,
  tierBadgeClass,
  entityTypeLabel,
  eventTypeLabel,
} from "~/lib/format";
import { InterpretationPanel } from "../../_components/interpretation-panel";
import { ThesisLensCard } from "../../_components/thesis-lens-card";
import { NewsActions } from "../../_components/news-actions";
import { BookmarkButton } from "../../_components/bookmark-button";
import { BackButton } from "../../_components/back-button";
import { NewsCard } from "../../_components/news-card";
import { SectionHead, displayCls } from "../../_components/section-head";

export const dynamic = "force-dynamic";

// generateMetadata 与页面共用一次查询（React cache 去重）。
const getNews = cache((id: string) => api.news.byId({ id }));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const n = await getNews(id);
  if (!n) return { title: "未找到", robots: { index: false, follow: false } };
  const title = clip(n.title, 70);
  const description = clip(n.summary);
  const url = `/news/${id}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: openGraph({
      type: "article",
      url: abs(url),
      title,
      description,
      publishedTime: new Date(n.publishedAt).toISOString(),
    }),
    twitter: twitter({ title, description }),
  };
}

export default async function NewsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const n = await getNews(id);
  if (!n) notFound();

  const session = await auth();
  const [bookmarked, , related, thesisLens] = await Promise.all([
    session?.user
      ? api.bookmarks.isBookmarked({ newsId: n.id })
      : Promise.resolve(false),
    api.analytics.track({ type: "view_news", newsId: n.id }),
    api.news.related({ id: n.id }),
    api.interpret.thesisLens({ newsId: n.id }),
  ]);
  const published = new Date(n.publishedAt);

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-6xl lg:px-8">
      <script
        {...jsonLdScript(
          newsArticleJsonLd({
            id: n.id,
            title: n.title,
            summary: n.summary,
            publishedAt: new Date(n.publishedAt),
            sourceName: n.source.name,
          }),
        )}
      />
      <BackButton />

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={tierBadgeClass(n.tier)}>
              {sourceTierLabel(n.tier)}
            </span>
            {n.eventType ? (
              <span className="rounded bg-brand/10 px-1.5 py-0.5 font-medium text-brand">
                {eventTypeLabel(n.eventType)}
              </span>
            ) : null}
            <span>{n.source.name}</span>
            <span aria-hidden>·</span>
            <time
              dateTime={published.toISOString()}
              title={published.toLocaleString("zh-CN", { hour12: false })}
              className="tabular"
            >
              {relativeTime(published)}
            </time>
          </div>

          <h1 className={`mt-2 text-balance text-2xl leading-snug lg:text-3xl ${displayCls}`}>
            {n.title}
          </h1>

          {n.entities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {n.entities.map(({ entity: e }) => (
                <Link
                  key={e.id}
                  href={`/entity/${e.id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-brand"
                >
                  {e.name}
                  <span className="text-muted">{entityTypeLabel(e.type)}</span>
                </Link>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <NewsActions
              title={n.title}
              entities={n.entities.map(({ entity: e }) => ({
                id: e.id,
                name: e.name,
              }))}
            />
            {session?.user ? (
              <BookmarkButton newsId={n.id} initial={bookmarked} />
            ) : (
              <Link
                href={`/login?returnTo=/news/${n.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted transition-colors hover:border-brand hover:text-brand"
              >
                ☆ 登录后收藏 · 同步关注
              </Link>
            )}
          </div>

          {n.content ? (
            <article className="mt-6 whitespace-pre-wrap text-base leading-8 text-ink/90 text-justify [text-justify:inter-ideograph]">
              {n.content}
            </article>
          ) : n.summary ? (
            <p className="mt-6 text-base leading-8 text-ink/90 text-justify [text-justify:inter-ideograph]">
              {n.summary}
            </p>
          ) : (
            <p className="mt-5 text-sm text-muted">
              本条仅标题，点下方「查看原文 ↗」阅读全文。
            </p>
          )}

          <div className="mt-5">
            <a
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted transition-colors hover:border-brand hover:text-brand"
            >
              查看原文 ↗
            </a>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <ThesisLensCard groups={thesisLens} />
          <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
              <h2 className="text-base font-bold text-ink">AI 解读</h2>
              <span className="text-xs text-muted">中性解读 · 大师视角可选 · 非投资建议</span>
            </div>
            <InterpretationPanel newsId={n.id} title={n.title} summary={n.summary} />
          </section>
        </aside>
      </div>

      {related.length > 0 && (
        <section className="mt-8">
          <SectionHead title="相关资讯" hint={`${related.length}`} />
          <ul className="space-y-3">
            {related.map((r) => (
              <NewsCard key={r.id} n={r} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
