"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

/**
 * 「设为我的逻辑」（S1）：把共享 AI 基础框架采纳为用户自有逻辑。
 * 采纳后实体页改显 MyThesisCard，可编辑重点/敏感度/静音。
 */
export function AdoptThesisButton({ entityId }: { entityId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
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
      <label className="text-xs font-semibold text-muted">
        （可选）你为什么持有 / 关注它
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="一句话写下核心理由，日后逻辑有变时对照当初判断。"
        className="mt-1 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={adopt.isPending}
          onClick={() =>
            adopt.mutate({ entityId, reason: reason.trim() || null })
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
