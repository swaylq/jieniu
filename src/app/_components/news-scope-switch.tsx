import Link from "next/link";

/**
 * 个股页「资讯」tab 的口径开关：本公司 / 全部（2026-08-18）。
 *
 * 为什么需要它：绑定是**召回导向**的——个股资讯源按公司名做全文搜索，摘要里的顺带提及也算数。
 * 平时无所谓（实测 300 只股的最近 40 条里 82% 是自有），但一到「自己没消息、别人家出大事」
 * 的日子就翻车：sway 2026-08-18 报的国盾量子页，最近 40 条里只有 3 条是它自己的事，
 * 其余全是频准激光 IPO 的报道——它在那些稿子里只是被列举的**客户**。
 *
 * 所以默认切到「本公司」，但**两个数字都摆在台面上**、一键可回全量：产业链消息有时正是要看的，
 * 这里做的是给用户一把尺子，不是替他删新闻。
 */
export function NewsScopeSwitch({
  basePath,
  scope,
  ownTotal,
  allTotal,
}: {
  /** 不含 query 的路径，如 `/entity/xxx` */
  basePath: string;
  scope: "own" | "all";
  ownTotal: number;
  allTotal: number;
}) {
  // 全量与自有一样多 = 这只股没有「仅提及」的噪声，开关是死的，不画（少一个没用的控件）。
  if (allTotal <= ownTotal) return null;
  const cls = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-brand/10 text-brand"
        : "text-muted hover:text-ink"
    }`;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1">
      <Link
        href={`${basePath}?tab=news`}
        scroll={false}
        aria-current={scope === "own" ? "true" : undefined}
        className={cls(scope === "own")}
      >
        本公司 {ownTotal}
      </Link>
      <Link
        href={`${basePath}?tab=news&scope=all`}
        scroll={false}
        aria-current={scope === "all" ? "true" : undefined}
        className={cls(scope === "all")}
      >
        全部 {allTotal}
      </Link>
      <span className="text-faint ml-1 text-[11px]">
        {scope === "own"
          ? `已隐去 ${allTotal - ownTotal} 条只在正文里提到本公司的行业动态`
          : "「仅提及」= 标题没点到本公司，多半是别家的事"}
      </span>
    </div>
  );
}
