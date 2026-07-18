"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PRIMARY_NAV, isNavActive, type NavIconKey } from "~/lib/nav";
import { HomeIcon, CompassIcon, StarIcon, UserIcon } from "./icons";

const ICONS: Record<NavIconKey, typeof HomeIcon> = {
  home: HomeIcon,
  compass: CompassIcon,
  star: StarIcon,
  user: UserIcon,
  bell: HomeIcon, // 通知不入主导航（移动端在顶栏），此处不会用到
};

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
      <div className="mx-auto flex max-w-2xl">
        {PRIMARY_NAV.map(({ href, label, short, icon }) => {
          const Icon = ICONS[icon];
          const active = isNavActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                active ? "text-brand" : "text-muted hover:text-ink"
              }`}
            >
              {active ? (
                <span
                  className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-full bg-brand"
                  aria-hidden
                />
              ) : null}
              <Icon className="h-[22px] w-[22px]" />
              {short ?? label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
