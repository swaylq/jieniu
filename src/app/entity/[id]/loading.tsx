import { NewsListSkeleton } from "../../_components/news-card-skeleton";

export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="h-4 w-16 animate-pulse rounded bg-muted/20" />
      <div className="mt-3 h-8 w-40 animate-pulse rounded bg-muted/20" />
      <div className="mt-4 h-28 w-full animate-pulse rounded-xl bg-muted/20" />
      <div className="mt-6">
        <NewsListSkeleton />
      </div>
    </main>
  );
}
