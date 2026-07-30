/**
 * 换页过渡层。
 *
 * `template.tsx` 与 `layout.tsx` 的区别就在这儿：layout 跨导航复用，template **每次导航重新挂载**
 * ——所以挂在它身上的 CSS 动画每换一页跑一次，不需要任何 JS。动画定义在
 * `globals.css` 的 `.jn-page-in`（150ms 淡入 + 6px 上移）。
 *
 * 为什么需要它：换页时新内容是「瞬间替换」，加上骨架屏一闪，观感像整页重载。一层极短的淡入
 * 把跳变盖住，切换就变得连贯。刻意只有 150ms——过渡不该给「慢」再添时间。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="jn-page-in">{children}</div>;
}
