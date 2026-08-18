import Link from "next/link";
import { type ReactNode } from "react";
import { type Metadata } from "next";

import { api } from "~/trpc/server";
import { auth } from "~/server/auth";
import { NewsCard } from "../_components/news-card";
import { collapseReprints } from "~/lib/reprint";
import { AddWatchButton } from "../_components/add-watch-sheet";
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

function Masthead({
  subtitle,
  action,
}: {
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="pt-1 pb-4">
      <div className="flex items-center gap-2.5">
        <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
        <h1 className={`text-2xl ${displayCls}`}>
          我的自选
        </h1>
        {/* 加自选的常驻入口就该在「我的自选」这个标题旁边——小哈 2026-07-31：
            「入口不在顺手或者符合逻辑的地方」。手机上侧栏那个 `+` 根本不渲染。 */}
        {action ? <div className="ml-auto shrink-0">{action}</div> : null}
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

  const { items: rawItems } = await api.feed.myFeed();
  // 同一篇通稿被十几家媒体转发时，自选流会被一件事刷满一屏（见 lib/reprint.ts）。
  // 这里不传 subject——自选流跨多只股，没有「本页主体」可用，退回「非早报 → 重要性 → 最新」挑代表。
  const items = collapseReprints(rawItems);

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-4xl">
      <Masthead subtitle="你自选股的最新动态" action={<AddWatchButton />} />
      {items.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-muted">还没有自选任何标的</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <AddWatchButton label="＋ 加一只自选" />
            <Link
              href="/onboarding"
              className="text-sm text-muted transition-colors hover:text-brand"
            >
              走一遍引导 →
            </Link>
          </div>
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
