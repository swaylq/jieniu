import Link from "next/link";

/** 全站 404：友好兜底而非默认裸页。 */
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center p-8 text-center">
      <div className="mt-8 w-full rounded-xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-lg font-bold text-ink">页面不存在</h1>
        <p className="mt-2 text-sm text-muted">
          你访问的内容可能已被移除，或链接有误。
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-full bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
