"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

export function BookmarkButton({
  newsId,
  initial,
}: {
  newsId: string;
  initial: boolean;
}) {
  const [on, setOn] = useState(initial);
  const toggle = api.bookmarks.toggle.useMutation({
    onSuccess: (res) => setOn(res.bookmarked),
  });

  return (
    <button
      type="button"
      disabled={toggle.isPending}
      onClick={() => toggle.mutate({ newsId })}
      className={`rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50 ${
        on
          ? "border-brand bg-brand/10 text-brand"
          : "border-line text-muted hover:border-brand hover:text-brand"
      }`}
    >
      {on ? "★ 已收藏" : "☆ 收藏"}
    </button>
  );
}
