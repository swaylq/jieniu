"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

/**
 * 打开列表后停留多久算「看过了」。
 * 2026-08-03 实测下调 2500 → 800：真实数据说 2.5 秒太长——张楚寒 8-2 后打开了 11 次、
 * 7 条未读一条没标上，而无头浏览器停够 6 秒就正常标上了（未读 7→0，日志里有 markRead）。
 * 也就是说人根本待不到 2.5 秒。800ms 仍然需要**真实客户端挂载**（预取只到服务端、不水合，
 * 实测预取不触发埋点也不会水合），所以不会把「悬停一下」误当成看过。
 */
const AUTO_READ_DELAY_MS = 800;

/**
 * 「最新推送」的两个动作：全部标已读 + 邮件投递开关。
 * 邮件默认关——存量用户不会突然收信；开启时后端才铸退订令牌。
 *
 * 2026-08-02 复盘：263 次打开提醒中心，`readAt` 全库 0 条——因为只有点「全部标为已读」
 * 这个按钮才会标记。红点常驻的结果是用户学会无视它，本来就稀少的提醒进一步贬值。
 * 现在停留 2.5 秒自动标已读（按钮保留，给「就想立刻清掉」的人）。
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

  // 只自动标一次：router.refresh() 会重渲染本组件，没有这道闸就会反复发同一个 mutation。
  const autoDone = useRef(false);
  useEffect(() => {
    if (unread <= 0 || autoDone.current) return;
    const t = setTimeout(() => {
      autoDone.current = true;
      markRead.mutate({});
    }, AUTO_READ_DELAY_MS);
    return () => clearTimeout(t);
    // markRead 的引用每次渲染都变，挂进依赖会让定时器不断重建 → 永远等不到触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

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
