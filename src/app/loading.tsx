import { NewsListSkeleton } from "./_components/news-card-skeleton";

export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="h-8 w-56 animate-pulse rounded bg-muted/20" />
      <div className="mt-4 h-11 w-full animate-pulse rounded-xl bg-muted/20" />
      <div className="mt-8 h-5 w-24 animate-pulse rounded bg-muted/20" />
      <div className="mt-3">
        <NewsListSkeleton />
      </div>
    </main>
  );
}
