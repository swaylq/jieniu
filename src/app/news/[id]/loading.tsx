/**
 * 新闻详情页骨架。
 *
 * 之前这段没有自己的 `loading.tsx`，于是回退到根 `app/loading.tsx`——那是一张**列表**骨架
 * （大标题 + 搜索框 + 一串新闻卡）。点开一篇文章却闪出一个假列表，形状完全对不上，加载中的
 * 那半秒看着像跳错了页。这里按详情页真实布局摆：返回 → 元信息行 → 大标题 → 正文段落 → 右栏。
 *
 * 骨架的形状要跟着 `page.tsx` 的布局走（`max-w-2xl` / `lg:max-w-6xl` + 右栏 `20rem`），
 * 改版式时记得一起改，否则又会变成「加载时是一种样子、加载完跳成另一种」。
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-6xl lg:px-8">
      <div className="h-5 w-16 animate-pulse rounded bg-muted/20" />

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {/* 元信息行：等级徽标 · 来源 · 时间 */}
          <div className="flex items-center gap-2">
            <div className="h-5 w-10 animate-pulse rounded bg-muted/20" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted/15" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted/15" />
          </div>

          {/* 大标题（两行） */}
          <div className="mt-3 h-8 w-full animate-pulse rounded bg-muted/20" />
          <div className="mt-2 h-8 w-4/5 animate-pulse rounded bg-muted/20" />

          {/* 正文 */}
          <div className="mt-6 space-y-2.5">
            {["w-full", "w-full", "w-11/12", "w-full", "w-2/3"].map((w, i) => (
              <div
                key={i}
                className={`h-4 animate-pulse rounded bg-muted/15 ${w}`}
              />
            ))}
          </div>

          {/* 解读面板 */}
          <div className="mt-6 h-28 w-full animate-pulse rounded-xl bg-muted/15" />
        </div>

        {/* 右栏：相关 */}
        <div className="hidden lg:block">
          <div className="h-5 w-20 animate-pulse rounded bg-muted/20" />
          <div className="mt-3 space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-16 w-full animate-pulse rounded-xl bg-muted/15"
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
