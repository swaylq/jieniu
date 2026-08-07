"use client";

import Link, { useLinkStatus } from "next/link";

export type EntityTab = { key: string; label: string };

/**
 * 个股页的 tab 条。抽成客户端组件是为了那个转圈——sway 报「切 tab 特别慢特别卡」。
 *
 * 实测（公网、无头 Chrome）：点下去到新 tab 真正上屏 **464–1153ms**，而这段时间里
 * **主线程长任务 0 个**——不是卡在渲染，是卡在「一次完整的服务端往返」：全站 `force-dynamic`，
 * 切 tab 等于把个股页（全站最重的一页）整个重渲一遍。
 *
 * 更要命的是这一秒里**屏幕上什么都不动**：tab 导航不换 segment，Next 不会亮 `loading.tsx`；
 * 而切 tab 又刚刚（sway 直报 ②）改成不再弹回顶部——之前那一跳好歹是个「有反应」的信号。
 * 于是就有了「点死了」的观感。这里给正在加载的那个 tab 就地加一个转圈，实测点击后
 * **5–11ms** 出现，先把「点击有回应」这件事做实。
 *
 * **真正的提速要动结构**（把列表拆进自己的 Suspense 段，或干脆客户端切 tab），不在这个文件里。
 * 也试过悬停预取（`prefetch={warm ? true : undefined}`），实测两条路径耗时重叠、看不出增益，
 * 就没留——没有实测支撑的优化不值得多那份服务端渲染。
 */
function TabSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="border-line border-t-brand ml-1.5 inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] align-[-1px]"
    />
  );
}

function TabLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      /* 切 tab 别把人从列表深处甩回页首（sway 直报 ②）。这里关掉的是 Next 自己的滚动，
         `#main-content` 那份复位由 `ScrollReset` + `lib/scroll-reset-policy` 负责。 */
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`-mb-px inline-flex items-center border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-brand text-brand font-semibold"
          : "text-muted hover:text-ink border-transparent"
      }`}
    >
      {label}
      <TabSpinner />
    </Link>
  );
}

/**
 * 翻页时要滚回的锚点。**必须是 tab 条前面一个不 sticky 的零高度元素**——
 * tab 条自己是 sticky 的，滚过之后 `getBoundingClientRect()` 给的是「吸住后的位置」
 * （永远贴着容器顶），拿它算偏移永远是 0、页面纹丝不动。见 `scroll-reset.tsx`。
 */
export const TAB_ANCHOR_ID = "entity-tabs-anchor";

export function EntityTabs({
  basePath,
  tabs,
  active,
}: {
  basePath: string;
  tabs: EntityTab[];
  active: string;
}) {
  return (
    <>
      <div id={TAB_ANCHOR_ID} aria-hidden className="h-0" />
      {/* sticky（sway 2026-07-31）：往下翻列表时 tab 条黏在顶上，随时能切。
          `top-0` 是相对 `#main-content` 这个滚动容器（外壳锁死一屏、滚动只发生在它里面）。
          必须带**不透明**底色，否则滚过去的卡片会从字缝里透出来。
          不用负 margin 铺满：tab 条在左栏里，拉出去会盖到右栏。 */}
      <div className="border-line bg-canvas sticky top-0 z-20 flex gap-1 border-b">
        {tabs.map((t) => (
          <TabLink
            key={t.key}
            href={`${basePath}?tab=${t.key}`} /* 切 tab 回到第 1 页 */
            active={active === t.key}
            label={t.label}
          />
        ))}
      </div>
    </>
  );
}
