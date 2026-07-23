import Link from "next/link";
import { type Metadata } from "next";

import { api } from "~/trpc/server";
import { auth } from "~/server/auth";
import { NewsCard } from "../_components/news-card";
import { displayCls, primaryBtn } from "../_components/section-head";
import { abs, openGraph, twitter } from "~/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "资讯流 一手财经动态",
  description:
    "解牛资讯流：聚焦式一手公告与重磅财经资讯，按重要性与时间排序，只呈现真正影响投资逻辑的动态，而非每条新闻。",
  alternates: { canonical: "/feed" },
  openGraph: openGraph({
    url: abs("/feed"),
    title: "资讯流 一手财经动态 · 解牛",
    description: "聚焦式一手公告与重磅财经资讯，按重要性与时间排序。",
  }),
  twitter: twitter({ title: "资讯流 一手财经动态 · 解牛" }),
};

function Masthead({ subtitle }: { subtitle?: string }) {
  return (
    <header className="pt-1 pb-4">
      <div className="flex items-center gap-2.5">
        <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
        <h1 className={`text-2xl ${displayCls}`}>
          我的自选
        </h1>
      </div>
      {subtitle ? <p className="mt-2 text-sm text-muted">{subtitle}</p> : null}
    </header>
  );
}

export default async function FeedPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="mx-auto max-w-2xl p-4 lg:max-w-4xl">
        <Masthead />
        <div className="mt-2 rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-muted">登录后查看你自选股的最新动态</p>
          <Link href="/login" className={`mt-4 ${primaryBtn}`}>
            邮箱登录
          </Link>
        </div>
      </main>
    );
  }

  const { items } = await api.feed.myFeed();

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-4xl">
      <Masthead subtitle="你自选股的最新动态" />
      {items.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-muted">还没有自选任何标的</p>
          <Link href="/onboarding" className={`mt-3 ${primaryBtn}`}>
            一键添加感兴趣的板块 →
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => (
            <NewsCard key={n.id} n={n} />
          ))}
        </ul>
      )}
    </main>
  );
}
