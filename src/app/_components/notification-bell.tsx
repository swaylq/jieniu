"use client";

import Link from "next/link";

import { api } from "~/trpc/react";
import { badgeText } from "~/lib/format";
import { BellIcon } from "./icons";

export function NotificationBell() {
  const { data: count } = api.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  return (
    <Link
      href="/notifications"
      className="relative flex rounded-md p-2 text-muted transition-colors hover:text-brand"
      aria-label="通知"
    >
      <BellIcon className="h-6 w-6" />
      {typeof count === "number" && count > 0 && (
        <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
          {badgeText(count)}
        </span>
      )}
    </Link>
  );
}
