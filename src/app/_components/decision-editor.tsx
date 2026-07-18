"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { DECISION_ACTIONS, ACTION_LABEL, type DecisionAction } from "~/lib/decision";
import type { DriftLevel } from "~/lib/drift";
import { DriftGuardCard } from "./drift-guard-card";
import { fieldClsSm } from "./section-head";

const numOrNull = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** 决策录入（P4-3）：选动作 + 写理由 + 可选记价。合规:记录你自己的决策，非平台建议。 */
export function DecisionEditor({
  entityId,
  defaultOpen = false,
}: {
  entityId: string;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [action, setAction] = useState<DecisionAction>("BUY");
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState("");
  const [drift, setDrift] = useState<{ level: DriftLevel; message: string } | null>(
    null,
  );

  const create = api.decision.create.useMutation({
    onSuccess: () => {
      setReason("");
      setPrice("");
      setDrift(null);
      setOpen(false);
      router.refresh();
    },
  });

  function doCreate() {
    create.mutate({
      entityId,
      action,
      reason: reason.trim(),
      price: numOrNull(price),
    });
  }

  // 加仓/买入前先过 Thesis Drift Guard；被挑战则展示自查卡，否则直接录入。
  const driftCheck = api.decision.driftCheck.useMutation({
    onSuccess: (res) => {
      if (res.shouldChallenge && res.message) {
        setDrift({ level: res.level, message: res.message });
      } else {
        doCreate();
      }
    },
    onError: () => doCreate(), // drift 检查失败不应阻断录入
  });

  function onSave() {
    if (action === "BUY" || action === "ADD") {
      driftCheck.mutate({ entityId, action });
    } else {
      doCreate();
    }
  }

  const busy = create.isPending || driftCheck.isPending;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/20"
      >
        ＋ 记一笔决策
      </button>
    );
  }

  const field = fieldClsSm;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {DECISION_ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAction(a)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              action === a
                ? "bg-brand text-white"
                : "border border-line text-muted hover:text-ink"
            }`}
          >
            {ACTION_LABEL[a]}
          </button>
        ))}
      </div>
      <textarea
        className={`${field} resize-none`}
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="为什么做这个决策？（你的理由——会作为日后自查投资逻辑的锚）"
      />
      <input
        className={field}
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="记价（选填，仅观察、不算盈亏）"
      />
      {drift ? (
        <DriftGuardCard
          level={drift.level}
          message={drift.message}
          pending={create.isPending}
          onConfirm={doCreate}
          onCancel={() => setDrift(null)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={onSave}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {driftCheck.isPending
                ? "核对逻辑…"
                : create.isPending
                  ? "保存中…"
                  : "保存决策"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted hover:text-ink"
            >
              取消
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            记录你自己的决策与理由，非平台建议、不构成买卖依据。买入 / 加仓前解牛会帮你对照原始逻辑自查。
          </p>
        </>
      )}
    </div>
  );
}
