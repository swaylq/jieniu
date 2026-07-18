"use client";

/** 根错误边界：任何未捕获的渲染/数据错误都落到这里，给可重试的兜底而非白屏。 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center p-8 text-center">
      <div className="mt-8 w-full rounded-xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-lg font-bold text-ink">出错了</h1>
        <p className="mt-2 text-sm text-muted">
          页面加载遇到问题，请稍后重试。
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          重试
        </button>
      </div>
    </main>
  );
}
