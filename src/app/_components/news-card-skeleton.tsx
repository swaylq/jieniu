/** 资讯卡骨架屏：加载时占位，尺寸仿 NewsCard，明暗自适应。 */
export function NewsCardSkeleton() {
  return (
    <li className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex gap-2">
        <div className="h-4 w-10 animate-pulse rounded bg-muted/20" />
        <div className="h-4 w-24 animate-pulse rounded bg-muted/20" />
      </div>
      <div className="h-4 w-3/4 animate-pulse rounded bg-muted/20" />
      <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted/20" />
      <div className="mt-1.5 h-3 w-5/6 animate-pulse rounded bg-muted/20" />
    </li>
  );
}

export function NewsListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <NewsCardSkeleton key={i} />
      ))}
    </ul>
  );
}
