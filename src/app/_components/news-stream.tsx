"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { NewsTimeline } from "./news-timeline";
import { NewsListSkeleton } from "./news-card-skeleton";

type StreamFilter = "all" | "primary" | "important";

const TABS: { key: StreamFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "primary", label: "一手" },
  { key: "important", label: "重磅" },
];

function tabCls(active: boolean): string {
  return `rounded-full border px-3 py-1 text-sm transition-colors ${
    active
      ? "border-brand bg-brand/10 text-brand"
      : "border-line text-muted hover:border-brand hover:text-brand"
  }`;
}

/** 首页「最新」一手时间轴：游标分页 + 全部/一手/重磅 切换 + 加载更多。 */
export function NewsStream() {
  const [filter, setFilter] = useState<StreamFilter>("all");

  const query = api.news.latest.useInfiniteQuery(
    { limit: 20, filter },
    { getNextPageParam: (last) => last.nextCursor },
  );

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            className={tabCls(filter === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <NewsListSkeleton />
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-muted">
          {filter === "important" ? "暂无重磅资讯" : "暂无最新资讯"}
        </p>
      ) : (
        <NewsTimeline items={items} />
      )}

      <div className="mt-4 flex justify-center">
        {query.hasNextPage ? (
          <button
            type="button"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
            className="rounded-full border border-line px-5 py-2 text-sm text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            {query.isFetchingNextPage ? "加载中…" : "加载更多"}
          </button>
        ) : items.length > 0 ? (
          <p className="text-xs text-muted">没有更多了</p>
        ) : null}
      </div>
    </div>
  );
}
