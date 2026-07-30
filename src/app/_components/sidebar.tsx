"use client";

import { useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

import { api } from "~/trpc/react";
import { badgeText, orderWatchEntities } from "~/lib/format";
import { watchEntityLabel } from "~/lib/watch-label";
import {
  PRIMARY_NAV,
  NOTIFICATION_NAV,
  isNavActive,
  type NavIconKey,
} from "~/lib/nav";
import {
  HomeIcon,
  CompassIcon,
  StarIcon,
  BellIcon,
  UserIcon,
  SearchIcon,
  ChevronDownIcon,
} from "./icons";
import { LogoMark } from "./logo";
import { HoverPrefetchLink } from "./hover-prefetch-link";
import { UserAvatar } from "./user-avatar";
import { ThemeToggle } from "./theme-toggle";
import { ColorblindToggle } from "./colorblind-toggle";
import { useCommandPalette } from "./command-palette";

const ICONS: Record<NavIconKey, typeof HomeIcon> = {
  home: HomeIcon,
  compass: CompassIcon,
  star: StarIcon,
  user: UserIcon,
  bell: BellIcon,
};

// 侧栏「持仓与观察」头像块颜色：由 id 稳定散列取色（无 logo 时的一致视觉）。
const TILE_COLORS = [
  "#2f6df0", "#b5122e", "#0e8a6e", "#5b53c4",
  "#c2410c", "#0e7490", "#b45309", "#7c3aed",
];
function tileColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length]!;
}

/**
 * 导航挂起指示（必须渲染在 `<Link>` 内部——`useLinkStatus` 读的是 Link 提供的 context）。
 *
 * 覆盖的是「点了但还没提交路由」那段窗口：冷缓存 / 慢网下点击后 ~80ms 出现转圈，旧内容留在
 * 原位，用户知道点击生效了。**一旦路由提交到 loading 边界，`pending` 就变 false**，接手的是
 * 该段自己的骨架屏——所以 prefetch 命中时它压根不出现（实测正是如此），那才是想要的结果：
 * 快到不需要指示器。别因为「平时看不见」就以为它是死代码，冷启动那一下就靠它。
 */
function NavSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-sb-line border-t-brand"
    />
  );
}

/**
 * 桌面端左侧「私人投研工作台」暗色侧边栏：徽标 + 工作台导航 + 持仓与观察 + 底部账号。仅 md+ 显示。
 *
 * **垂直预算**：中间那段「持仓与观察」是唯一可滚动区（`flex-1`），其余三段都 `shrink-0`——
 * 所以上下两段每省一像素都直接变成持仓窗口的高度。故上段（徽标 / 搜索 / 导航）与下段（外观开关 /
 * 账号）刻意压紧、字号收到 10–13px；持仓行本身**不再压**（它才是主角），只把两行文字收成
 * `leading-tight`。改这里前先想清楚会从持仓窗口里拿走多少高度。
 */
export function Sidebar({
  loggedIn,
  email,
}: {
  loggedIn: boolean;
  email: string | null;
}) {
  const pathname = usePathname();
  const { setOpen } = useCommandPalette();
  const [menuOpen, setMenuOpen] = useState(false);

  const watchlist = api.watchlist.list.useQuery(undefined, {
    enabled: loggedIn,
  });
  const watched = orderWatchEntities(
    (watchlist.data ?? []).map((w) => w.entity),
  );
  const unread = api.notifications.unreadCount.useQuery(undefined, {
    enabled: loggedIn,
    refetchInterval: 60_000,
  });
  const unreadCount = unread.data ?? 0;

  const navItems = [...PRIMARY_NAV, NOTIFICATION_NAV];

  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col overflow-hidden border-r border-sb-line bg-sb text-sb-ink md:flex">
      <div className="shrink-0 p-3.5 pb-3">
        <Link
          href="/"
          aria-label="解牛首页"
          className="flex items-center gap-2.5 px-1 py-0.5"
        >
          <LogoMark className="h-9 w-9 shrink-0" />
          <span className="min-w-0">
            <span className="block text-[17px] font-extrabold leading-tight tracking-wide">
              解牛
            </span>
            <span className="block truncate text-[10.5px] leading-tight text-sb-muted">
              你的私人投研 Agent
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 flex w-full items-center gap-2 rounded-xl border border-sb-line bg-sb-2/50 px-3 py-1.5 text-[13px] text-sb-muted transition-colors hover:border-brand/50 hover:text-sb-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <SearchIcon className="h-3.5 w-3.5" />
          <span>搜索</span>
          <kbd className="tabular ml-auto rounded border border-sb-line px-1.5 py-0.5 text-[10px] text-sb-faint">
            ⌘K
          </kbd>
        </button>

        <div className="px-2 pb-1 pt-3.5 text-[10px] font-semibold uppercase tracking-[1.4px] text-sb-faint">
          工作台
        </div>
        <nav className="flex flex-col gap-px">
          {navItems.map(({ href, label, icon }) => {
            const Icon = ICONS[icon];
            const active = isNavActive(pathname, href);
            const showBadge = href === "/notifications" && unreadCount > 0;
            return (
              <Link
                key={href}
                href={href}
                /* prefetch 主导航的**完整**载荷（含动态段）：把那次隧道往返挪到点击之前，
                   点下去直接从客户端路由缓存出内容。配合 next.config 的 staleTimes.dynamic
                   才有效——默认 0 的话 prefetch 回来的东西不会被复用。 */
                prefetch
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] font-medium leading-tight transition-colors ${
                  active
                    ? "bg-sb-2 text-sb-ink"
                    : "text-sb-muted hover:bg-sb-2 hover:text-sb-ink"
                }`}
              >
                {active && (
                  <span
                    className="absolute -left-3.5 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-brand"
                    aria-hidden
                  />
                )}
                <Icon className="h-[17px] w-[17px] shrink-0 opacity-90" />
                {label}
                {showBadge && (
                  <span className="tabular ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                    {badgeText(unreadCount)}
                  </span>
                )}
                <NavSpinner />
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-sb-line px-3.5 pt-2.5">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[10px] font-semibold uppercase tracking-[1.4px] text-sb-faint">
            持仓与观察{watched.length > 0 ? ` · ${watched.length}` : ""}
          </span>
          <Link
            href="/discover"
            aria-label="添加自选"
            className="flex h-5 w-5 items-center justify-center rounded-md bg-sb-2 text-sm font-semibold text-brand transition-colors hover:bg-sb-line"
          >
            +
          </Link>
        </div>
        {!loggedIn ? (
          <p className="px-1 py-2 text-xs text-sb-muted">登录后同步你的自选</p>
        ) : watched.length === 0 ? (
          <p className="px-1 py-2 text-xs text-sb-muted">
            还没有自选，去
            <Link href="/discover" className="text-brand hover:underline">
              机会雷达
            </Link>
          </p>
        ) : (
          /* 滚动窗口 + 底缘渐隐：被裁掉半行的那条从「像坏了」变成「明显还能往下滚」 */
          <div className="relative -mx-1 min-h-0 flex-1">
            <ul className="h-full space-y-px overflow-y-auto pb-4 no-scrollbar">
              {watched.map((e) => {
                const active = pathname === `/entity/${e.id}`;
                // 名字与代码分两行显示：孪生的公司/股票两份长得一样（sway 直报 ⑤）。
                const label = watchEntityLabel(e);
                return (
                  <li key={e.id}>
                    <HoverPrefetchLink
                      href={`/entity/${e.id}`}
                      className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
                        active ? "bg-sb-2" : "hover:bg-sb-2"
                      }`}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-bold text-white"
                        style={{ background: tileColor(e.id) }}
                      >
                        {label.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold leading-tight text-sb-ink">
                          {label.name}
                        </span>
                        <span className="block text-[10.5px] leading-tight text-sb-faint">
                          {label.sub}
                        </span>
                      </span>
                      {/* 个股页是全站最重的一页，点击反馈在这儿最值钱。预取策略见
                          `HoverPrefetchLink`：悬停/聚焦才拉，不在进页面时一次性拉光整个组合。 */}
                      <NavSpinner />
                    </HoverPrefetchLink>
                  </li>
                );
              })}
            </ul>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-sb to-transparent"
            />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-sb-line px-3.5 py-2.5">
        {/* 外观 / 配色两个开关并作一行——原来上下两行光标签就吃掉 ~46px，全还给持仓窗口。
            两个按钮各自带 aria-label，去掉文字标签不影响可达性。 */}
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[10.5px] text-sb-faint">外观 · 配色</span>
          <span className="-mr-1 flex items-center">
            <ThemeToggle />
            <ColorblindToggle />
          </span>
        </div>
        {loggedIn ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="账号菜单"
              className="flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-sb-2"
            >
              <UserAvatar seed={email} className="h-8 w-8 text-[13px]" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-sb-ink">
                {email ?? "解牛用户"}
              </span>
              <ChevronDownIcon
                className={`h-4 w-4 shrink-0 text-sb-muted transition-transform ${
                  menuOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="关闭菜单"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-xl border border-sb-line bg-sb-2 shadow-lg">
                  <Link
                    href="/profile"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2.5 text-sm text-sb-ink transition-colors hover:bg-sb-line"
                  >
                    我的组合
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2.5 text-sm text-sb-ink transition-colors hover:bg-sb-line"
                  >
                    设置
                  </Link>
                  <button
                    type="button"
                    onClick={() => void signOut({ callbackUrl: "/" })}
                    className="block w-full px-3 py-2.5 text-left text-sm text-red-400 transition-colors hover:bg-sb-line"
                  >
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <Link
            href={`/login?returnTo=${encodeURIComponent(pathname)}`}
            className="block rounded-full bg-brand px-4 py-2.5 text-center text-sm font-semibold text-[#1b1a17] transition-colors hover:bg-brand-dark"
          >
            登录
          </Link>
        )}
      </div>
    </aside>
  );
}
