"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef } from "react";

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
      /* `shrink-0` + `whitespace-nowrap`：五个 tab 的自然宽在 390px 屏上是 ~409px，可用只有 358px。
         flex 默认 `shrink:1` 会把它们压扁，标签就在「资讯 7523」中间那个空格上折行——实测每个 tab
         都是 2.1 行、tab 条从 37px 撑成 58px（sway 2026-08-08 截图）。放不下就让外层横向滚，不折行。

         小屏收窄到 `px-2`：不是为了塞下（塞不下，5 个 tab 怎么都超），是为了让最后一个 tab 露出
         半截当「还能滑」的提示——`px-3` 时「关系」正好整个躲在屏外，用户根本不知道它存在。 */
      className={`-mb-px inline-flex shrink-0 items-center border-b-2 px-2 py-2 text-sm whitespace-nowrap transition-colors sm:px-3 ${
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
  const scroller = useRef<HTMLDivElement>(null);
  // 选中的 tab 可能落在横向滚动区外（「关系」是最后一个，小屏上默认就在屏外），
  // 那样选中态整条是隐形的。进页面 / 切完 tab 后把它拨进视野。
  // 直接改 `scrollLeft`，不用 `scrollIntoView`——后者会连带滚动祖先容器（`#main-content`），
  // 等于又把人弹离列表，正是下面 `scroll={false}` 要避免的事。
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !el) return;
    const pad = 12; // 露出下一个 tab 的一点边，暗示还能滑
    const right = el.offsetLeft + el.offsetWidth;
    if (right > box.scrollLeft + box.clientWidth)
      box.scrollLeft = right - box.clientWidth + pad;
    else if (el.offsetLeft < box.scrollLeft)
      box.scrollLeft = Math.max(0, el.offsetLeft - pad);
  }, [active]);

  return (
    <>
      <div id={TAB_ANCHOR_ID} aria-hidden className="h-0" />
      {/* sticky（sway 2026-07-31）：往下翻列表时 tab 条黏在顶上，随时能切。
          `top-0` 是相对 `#main-content` 这个滚动容器（外壳锁死一屏、滚动只发生在它里面）。
          必须带**不透明**底色，否则滚过去的卡片会从字缝里透出来。
          不用负 margin 铺满：tab 条在左栏里，拉出去会盖到右栏。

          横向滚动放**外层**、下边框和 tab 一起放**内层**（sway 2026-08-08 移动端折行）：选中态是
          `border-b-2` 靠 `-mb-px` 压在下边框上合成一条线，而滚动容器按 padding box 裁剪，负 margin
          溢出的那 1px 会被剪掉、选中条从 2px 变 1px——所以带负 margin 的这层不能同时是滚动容器。
          内层 `w-max min-w-full`：内容宽时撑开跟着滚，桌面内容窄时仍铺满一行、下边框不断。 */}
      <div
        ref={scroller}
        className="bg-canvas no-scrollbar sticky top-0 z-20 overflow-x-auto"
      >
        <div className="border-line flex w-max min-w-full gap-1 border-b">
          {tabs.map((t) => (
            <TabLink
              key={t.key}
              href={`${basePath}?tab=${t.key}`} /* 切 tab 回到第 1 页 */
              active={active === t.key}
              label={t.label}
            />
          ))}
        </div>
      </div>
    </>
  );
}
