import Link from "next/link";

import { streamStamp } from "~/lib/format";
import type { AlertKind } from "~/lib/alert-outbox";
import { InboxActions } from "./inbox-actions";

export type InboxItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  occurredAt: Date;
  priority: number;
  readAt: Date | null;
  emailedAt: Date | null;
};

const KIND_LABEL: Record<AlertKind, string> = {
  logic: "逻辑异动",
  fundamental: "重磅资讯",
  price: "到价提醒",
};

function kindLabel(k: string): string {
  return KIND_LABEL[k as AlertKind] ?? k;
}

/**
 * 「最新推送」——站内 inbox。读 AlertEvent（Outbox），即**真正投递过的事实**。
 * 与下方三个派生区的区别：那三个回答「现在查得到什么」，这里回答「发生过什么、告诉过你没有、从哪个渠道」。
 * 站内不限流；限流只作用在站外投递。
 */
export function PushInbox({
  items,
  unread,
  emailEnabled,
  email,
}: {
  items: InboxItem[];
  unread: number;
  emailEnabled: boolean;
  email: string | null;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
        <h2 className="text-base font-bold text-ink">最新推送</h2>
        {unread > 0 ? (
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
            {unread} 条未读
          </span>
        ) : null}
      </div>
      <p className="text-xs leading-relaxed text-muted">
        解牛主动找过你的记录——不是「现在有什么」，而是
        <span className="font-medium text-ink">发生了什么、告诉过你没有</span>。
      </p>

      <InboxActions unread={unread} emailEnabled={emailEnabled} email={email} />

      {items.length === 0 ? (
        <div className="mt-3 rounded-xl border border-line bg-surface p-6 text-center">
          <p className="text-sm text-muted">
            还没有推送记录。关注股票、生成投资逻辑后，触及它的变化会主动找你。
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((it) => {
            const unreadItem = it.readAt === null;
            const inner = (
              <>
                <div className="flex flex-wrap items-center gap-2 pr-8">
                  <span className="rounded bg-line/60 px-1.5 py-0.5 text-[11px] font-medium text-muted">
                    {kindLabel(it.kind)}
                  </span>
                  <span className="tabular text-[11px] text-muted">
                    {streamStamp(it.occurredAt)}
                  </span>
                  <span className="text-[11px] text-muted">
                    {it.emailedAt ? "· 已发邮件" : "· 仅站内"}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed font-semibold text-ink">
                  {it.title}
                </p>
                {it.body ? (
                  <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink/75">
                    {it.body}
                  </p>
                ) : null}
              </>
            );
            const cls = `relative block rounded-xl border bg-surface p-4 transition-colors ${
              unreadItem
                ? "border-brand/30 ring-1 ring-brand/40"
                : "border-line opacity-75"
            }`;
            return (
              <li key={it.id}>
                {it.url ? (
                  <Link href={it.url} className={`${cls} hover:border-brand`}>
                    {unreadItem ? (
                      <span
                        className="absolute top-3 right-3 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand"
                        aria-label="未读"
                      >
                        新
                      </span>
                    ) : null}
                    {inner}
                  </Link>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
