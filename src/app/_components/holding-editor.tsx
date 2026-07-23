"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { fieldClsSm } from "./section-head";

export type HoldingInitial = {
  status: string;
  costBasis: number | null;
  weight: number | null;
  targetWeight: number | null;
  note: string | null;
} | null;

const numOrNull = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/** 我的持仓编辑器（P4-1）：手录成本/仓位/目标，仅观察用。颜色 amber/灰，不涉红绿、不给盈亏/买卖。 */
export function HoldingEditor({
  entityId,
  initial,
  bare = false,
}: {
  entityId: string;
  initial: HoldingInitial;
  /** true = 并入「我的」合并卡：不渲染自带卡壳/大标题/空态说明段。 */
  bare?: boolean;
}) {
  const router = useRouter();
  const isHolding = initial?.status === "HOLDING";
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState(initial?.costBasis?.toString() ?? "");
  const [weight, setWeight] = useState(initial?.weight?.toString() ?? "");
  const [target, setTarget] = useState(initial?.targetWeight?.toString() ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  const upsert = api.portfolio.upsert.useMutation({
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  function save(status: "HOLDING" | "WATCH") {
    upsert.mutate({
      entityId,
      status,
      costBasis: numOrNull(cost),
      weight: numOrNull(weight),
      targetWeight: numOrNull(target),
      note: note.trim() || null,
    });
  }

  const field = fieldClsSm;
  const stat = (label: string, v: number | null, suffix = "") =>
    v == null ? null : (
      <div className="flex flex-col">
        <span className="text-[11px] text-muted">{label}</span>
        <span className="tabular text-sm font-semibold text-ink">
          {v}
          {suffix}
        </span>
      </div>
    );

  // bare：并入个股页「我的」合并卡时用——去掉自带卡壳与标题（由外层统一提供），
  // 空态也不再写整段说明文案（三张卡各写一段是信息过载的主因）。
  const Shell = ({ children }: { children: React.ReactNode }) =>
    bare ? (
      <div>{children}</div>
    ) : (
      <section className="rounded-xl border border-brand/30 bg-brand/[0.04] p-4">
        {children}
      </section>
    );

  return (
    <Shell>
      <div className="flex items-center gap-2">
        {bare ? (
          <h4 className="text-xs font-semibold text-muted">持仓</h4>
        ) : (
          <>
            <span aria-hidden>📌</span>
            <h3 className="text-sm font-bold text-ink">我的持仓</h3>
          </>
        )}
        {isHolding ? (
          <span className="ml-auto rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand">
            持仓中
          </span>
        ) : null}
      </div>

      {!open ? (
        isHolding ? (
          <div className="mt-2">
            <div className="grid grid-cols-3 gap-2">
              {stat("成本", initial?.costBasis ?? null)}
              {stat("仓位", initial?.weight ?? null, "%")}
              {stat("目标", initial?.targetWeight ?? null, "%")}
            </div>
            {initial?.note ? (
              <p className="mt-2 text-xs leading-relaxed text-muted">{initial.note}</p>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-2 text-xs font-semibold text-brand hover:underline"
            >
              编辑持仓 ›
            </button>
          </div>
        ) : (
          <div className="mt-2">
            {!bare ? (
              <p className="text-xs leading-relaxed text-muted">
                标记为持仓后，解牛会围绕你的成本与仓位判断「今天的事有没有动你的逻辑」。
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={`${bare ? "" : "mt-3 "}rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/20`}
            >
              ＋ 记为持仓
            </button>
          </div>
        )
      ) : (
        <div className="mt-3 space-y-2.5">
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">成本价</span>
              <input
                className={field}
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="选填"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">仓位 %</span>
              <input
                className={field}
                inputMode="decimal"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="0–100"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">目标 %</span>
              <input
                className={field}
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="0–100"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">备注（为什么买 / 计划）</span>
            <textarea
              className={`${field} resize-none`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="选填，如：看好毛利率兑现，140 附近计划加仓"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={upsert.isPending}
              onClick={() => save("HOLDING")}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {upsert.isPending ? "保存中…" : "保存为持仓"}
            </button>
            {isHolding ? (
              <button
                type="button"
                disabled={upsert.isPending}
                onClick={() => save("WATCH")}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
              >
                转为观察
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted hover:text-ink"
            >
              取消
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            成本 / 仓位仅用于观察与个性化提醒，非投资建议、不计算盈亏。
          </p>
        </div>
      )}
    </Shell>
  );
}
