import { NewsListSkeleton } from "../_components/news-card-skeleton";

export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="h-8 w-32 animate-pulse rounded bg-muted/20" />
      <div className="mt-6">
        <NewsListSkeleton />
      </div>
    </main>
  );
}
