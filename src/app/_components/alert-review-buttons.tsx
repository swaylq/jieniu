"use client";

import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

/** 提醒复核按钮（S3 闭环）：复核 / 不相关 → 该维度沉底不再打扰，直到出现更晚的新跨越。 */
export function AlertReviewButtons({
  entityId,
  dimensionKey,
  crossedAt,
}: {
  entityId: string;
  dimensionKey: string;
  crossedAt: Date;
}) {
  const router = useRouter();
  const review = api.notifications.reviewThesisAlert.useMutation({
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-muted">复核后不再打扰：</span>
      <button
        type="button"
        disabled={review.isPending}
        onClick={() =>
          review.mutate({ entityId, dimensionKey, crossedAt, action: "reviewed" })
        }
        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
      >
        已复核
      </button>
      <button
        type="button"
        disabled={review.isPending}
        onClick={() =>
          review.mutate({ entityId, dimensionKey, crossedAt, action: "dismissed" })
        }
        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
      >
        不相关
      </button>
    </div>
  );
}
