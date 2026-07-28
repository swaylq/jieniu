/**
 * 形状对得上的骨架——没有它会回退到根骨架，点进财报前瞻会闪出一张假的资讯列表
 * （`evolution/lessons.md`：每个重页面都该有自己的 loading.tsx）。
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-3xl lg:px-8">
      <div className="h-4 w-24 animate-pulse rounded bg-line/60" />
      <div className="mt-3 h-8 w-32 animate-pulse rounded bg-line/70" />
      <div className="mt-2 h-4 w-48 animate-pulse rounded bg-line/50" />

      {/* 倒计时头 */}
      <div className="mt-5 h-24 animate-pulse rounded-2xl border border-brand/20 bg-brand/[0.04]" />

      {/* 预期 / 历史反应 / 逻辑校验三块 */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="mt-6 h-40 animate-pulse rounded-2xl border border-line bg-surface"
        />
      ))}
    </main>
  );
}
