"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

import { api } from "~/trpc/react";
import { badgeText, entityTypeLabel, orderWatchEntities } from "~/lib/format";
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

/** 桌面端左侧「私人投研工作台」暗色侧边栏：logo + 工作台导航 + 持仓与观察 + 底部账号。仅 md+ 显示。 */
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
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sb-line bg-sb text-sb-ink md:flex">
      <div className="p-3.5">
        <Link
          href="/"
          aria-label="解牛首页"
          className="flex items-center gap-3 px-2 py-1.5"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-xl font-extrabold text-[#1b1a17] shadow-[0_4px_14px_rgba(245,166,35,.35)]">
            牛
          </span>
          <span>
            <span className="block text-lg font-extrabold tracking-wide">
              解牛
            </span>
            <span className="block text-[11px] text-sb-muted">
              你的私人投研 Agent
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 flex w-full items-center gap-2 rounded-xl border border-sb-line bg-sb-2/50 px-3 py-2.5 text-sm text-sb-muted transition-colors hover:border-brand/50 hover:text-sb-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <SearchIcon className="h-4 w-4" />
          <span>搜索</span>
          <kbd className="tabular ml-auto rounded border border-sb-line px-1.5 py-0.5 text-[10px] text-sb-faint">
            ⌘K
          </kbd>
        </button>

        <div className="px-2 pb-2 pt-5 text-[10.5px] font-semibold uppercase tracking-[1.5px] text-sb-faint">
          工作台
        </div>
        <nav className="flex flex-col gap-0.5">
          {navItems.map(({ href, label, icon }) => {
            const Icon = ICONS[icon];
            const active = isNavActive(pathname, href);
            const showBadge = href === "/notifications" && unreadCount > 0;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sb-2 text-sb-ink"
                    : "text-sb-muted hover:bg-sb-2 hover:text-sb-ink"
                }`}
              >
                {active && (
                  <span
                    className="absolute -left-3.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-brand"
                    aria-hidden
                  />
                )}
                <Icon className="h-[19px] w-[19px] opacity-90" />
                {label}
                {showBadge && (
                  <span className="tabular ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                    {badgeText(unreadCount)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-sb-line px-3.5 pt-4">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[1.5px] text-sb-faint">
            持仓与观察{watched.length > 0 ? ` · ${watched.length}` : ""}
          </span>
          <Link
            href="/discover"
            aria-label="添加自选"
            className="flex h-6 w-6 items-center justify-center rounded-lg bg-sb-2 text-base font-semibold text-brand transition-colors hover:bg-sb-line"
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
          <ul className="-mx-1 flex-1 space-y-0.5 overflow-y-auto pb-2 no-scrollbar">
            {watched.map((e) => {
              const active = pathname === `/entity/${e.id}`;
              return (
                <li key={e.id}>
                  <Link
                    href={`/entity/${e.id}`}
                    className={`flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors ${
                      active ? "bg-sb-2" : "hover:bg-sb-2"
                    }`}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-bold text-white"
                      style={{ background: tileColor(e.id) }}
                    >
                      {e.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-sb-ink">
                        {e.name}
                      </span>
                      <span className="block text-[11px] text-sb-faint">
                        {entityTypeLabel(e.type)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-sb-line p-3.5">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-xs text-sb-muted">深色 / 浅色</span>
          <ThemeToggle />
        </div>
        <div className="mb-2.5 flex items-center justify-between px-1">
          <span className="text-xs text-sb-muted">色盲友好 · 橙涨蓝跌</span>
          <ColorblindToggle />
        </div>
        {loggedIn ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="账号菜单"
              className="flex w-full items-center gap-2.5 rounded-xl px-1.5 py-2 text-left transition-colors hover:bg-sb-2"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-sm font-extrabold text-[#1b1a17]">
                {(email ?? "解")[0]!.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-sb-ink">
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
