"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

/**
 * 「最新推送」的两个动作：全部标已读 + 邮件投递开关。
 * 邮件默认关——存量用户不会突然收信；开启时后端才铸退订令牌。
 */
export function InboxActions({
  unread,
  emailEnabled,
  email,
}: {
  unread: number;
  emailEnabled: boolean;
  email: string | null;
}) {
  const router = useRouter();
  const [on, setOn] = useState(emailEnabled);
  const [cleared, setCleared] = useState(false);

  const markRead = api.inbox.markRead.useMutation({
    onSuccess: () => {
      setCleared(true);
      router.refresh();
    },
  });
  const setPref = api.inbox.setEmailPref.useMutation({
    onSuccess: (r) => setOn(r.enabled),
  });

  const remaining = cleared ? 0 : unread;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line/70 bg-canvas px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span
          role="switch"
          aria-checked={on}
          aria-label="邮件投递"
          tabIndex={0}
          onClick={() => !setPref.isPending && setPref.mutate({ enabled: !on })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!setPref.isPending) setPref.mutate({ enabled: !on });
            }
          }}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
            on ? "bg-brand" : "bg-line"
          } ${setPref.isPending ? "opacity-60" : ""}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              on ? "translate-x-5" : "translate-x-0"
            }`}
            aria-hidden
          />
        </span>
        <span className="min-w-0 text-xs leading-relaxed text-muted">
          {on ? (
            <>
              重要变化会发到{" "}
              <span className="font-medium text-ink">{email ?? "你的邮箱"}</span>
              ；每次最多 5 条，22:00–07:30 静默
            </>
          ) : (
            <>邮件投递已关闭——提醒只留在站内</>
          )}
        </span>
      </div>
      {remaining > 0 ? (
        <button
          type="button"
          disabled={markRead.isPending}
          onClick={() => markRead.mutate({})}
          className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
        >
          全部标为已读
        </button>
      ) : null}
    </div>
  );
}
