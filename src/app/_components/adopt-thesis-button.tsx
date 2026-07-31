"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { WATCH_REASONS, composeWatchReason } from "~/lib/watch-reasons";

/**
 * 「设为我的逻辑」（S1）：把共享 AI 基础框架采纳为用户自有逻辑。
 * 采纳后实体页改显 MyThesisCard，可编辑重点/敏感度/静音。
 *
 * 理由与加自选浮层同款：标签点选，自由文本折叠成可选补充
 * （小哈 2026-07-31：「你要我写理由，我基本上就劝退了」）。
 */
export function AdoptThesisButton({
  entityId,
  status = "HOLDING",
}: {
  entityId: string;
  status?: "HOLDING" | "WATCH";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  const adopt = api.userThesis.adopt.useMutation({
    onSuccess: () => router.refresh(),
  });

  if (!open) {
    return (
      <div className="mt-3 rounded-xl border border-brand/30 bg-brand/[0.06] p-3">
        <p className="text-xs leading-relaxed text-ink/80">
          把这套框架设为<strong className="font-semibold text-brand">你自己的投资逻辑</strong>
          ——之后可标重点、调每个维度的提醒敏感度、静音你不关心的维度，解牛只按你在乎的盯。
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white"
        >
          设为我的逻辑 →
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-brand/30 bg-brand/[0.06] p-3">
      <p className="text-xs font-semibold text-muted">
        （可选）你{status === "HOLDING" ? "看好" : "关注"}它什么？
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {WATCH_REASONS.map((r) => {
          const on = tags.includes(r.key);
          return (
            <button
              key={r.key}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setTags((prev) =>
                  prev.includes(r.key)
                    ? prev.filter((k) => k !== r.key)
                    : [...prev, r.key],
                )
              }
              className={`rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                on
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-line bg-surface text-ink hover:border-brand"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2">
        {showExtra ? (
          <textarea
            autoFocus
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder="想多写两句就写，不写也行。"
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowExtra(true)}
            className="text-[11px] text-muted transition-colors hover:text-brand"
          >
            ＋ 想多写两句（可选）
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={adopt.isPending}
          onClick={() =>
            adopt.mutate({
              entityId,
              reason: composeWatchReason({ tags, status, extra }),
            })
          }
          className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {adopt.isPending ? "采纳中…" : "确认采纳"}
        </button>
        <button
          type="button"
          disabled={adopt.isPending}
          onClick={() => setOpen(false)}
          className="text-[11px] text-muted hover:text-ink"
        >
          取消
        </button>
        {adopt.isError ? (
          <span className="text-[11px] text-muted">采纳失败，请重试。</span>
        ) : null}
      </div>
    </div>
  );
}
