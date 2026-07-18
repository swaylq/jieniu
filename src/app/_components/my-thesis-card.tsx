"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { dirLabel } from "~/lib/thesis-status";
import {
  personalizeSignals,
  type Sensitivity,
  type UserDimension,
} from "~/lib/user-thesis";

type SignalItem = {
  dimensionKey: string;
  direction: string;
  materiality: number;
  note: string;
  newsTitle: string;
};

const SENS_LABEL: Record<Sensitivity, string> = { low: "低", normal: "中", high: "高" };
const SENS_ORDER: Sensitivity[] = ["low", "normal", "high"];

/**
 * 「我的投资逻辑」卡（S1）：用户自有、可编辑。用户拥有维度的重点/敏感度/静音，
 * 「近期触及你的逻辑」按本地维度实时个性化预览，保存后持久。共享 base 框架仍是冷启动来源。
 */
export function MyThesisCard({
  entityId,
  name,
  reason: reason0,
  dimensions: dims0,
  signals,
  updatedAt,
}: {
  entityId: string;
  name: string;
  reason: string | null;
  dimensions: UserDimension[];
  signals: SignalItem[];
  updatedAt: Date;
}) {
  const router = useRouter();
  const [reason, setReason] = useState(reason0 ?? "");
  const [dims, setDims] = useState<UserDimension[]>(dims0);
  const [dirty, setDirty] = useState(false);

  const update = api.userThesis.update.useMutation({
    onSuccess: () => {
      setDirty(false);
      router.refresh();
    },
  });
  const reset = api.userThesis.reset.useMutation({
    onSuccess: () => router.refresh(),
  });
  const remove = api.userThesis.remove.useMutation({
    onSuccess: () => router.refresh(),
  });
  const busy = update.isPending || reset.isPending || remove.isPending;

  // 本地实时个性化：随重点/敏感度/静音立即预览，无需先保存。
  const shown = useMemo(() => personalizeSignals(dims, signals), [dims, signals]);

  function patch(key: string, p: Partial<UserDimension>) {
    setDims((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));
    setDirty(true);
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-brand/30 bg-brand/[0.05] p-5">
      <div className="flex items-center gap-2">
        <span aria-hidden>🎯</span>
        <h2 className="text-base font-bold text-ink">我的投资逻辑 · {name}</h2>
        <span className="ml-auto shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand">
          我的 · 可编辑
        </span>
      </div>

      <div className="mt-3">
        <label className="text-xs font-semibold text-muted">
          我为什么持有 / 关注它
        </label>
        <textarea
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setDirty(true);
          }}
          rows={2}
          maxLength={500}
          placeholder="一句话写下你的核心理由，日后逻辑有变时解牛帮你对照当初判断。"
          className="mt-1 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none"
        />
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted">
          监控维度 · 你说了算
        </h3>
        {dims.map((d) => (
          <div
            key={d.key}
            className={`rounded-xl border border-line/70 bg-surface p-3 ${d.muted ? "opacity-60" : ""}`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => patch(d.key, { priority: !d.priority })}
                className={`text-sm leading-none ${d.priority ? "text-brand" : "text-muted/40 hover:text-muted"}`}
                aria-pressed={d.priority}
                title={d.priority ? "取消重点" : "标为重点"}
              >
                ★
              </button>
              <span className="text-sm font-medium text-ink">{d.key}</span>
              <button
                type="button"
                onClick={() => patch(d.key, { muted: !d.muted })}
                className="ml-auto text-[11px] text-muted hover:text-ink"
              >
                {d.muted ? "已静音 · 恢复" : "静音"}
              </button>
            </div>
            {d.watch ? (
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                {d.watch}
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-1">
              <span className="mr-1 text-[11px] text-muted">敏感度</span>
              {SENS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => patch(d.key, { sensitivity: s })}
                  className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                    d.sensitivity === s
                      ? "bg-brand/20 font-medium text-brand"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {SENS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted">
          近期触及你的逻辑 · {shown.length}
        </h3>
        {shown.length === 0 ? (
          <p className="text-xs text-muted">
            按你当前的维度与敏感度，近期没有需要关注的动态。
          </p>
        ) : (
          <ul className="space-y-2.5">
            {shown.slice(0, 8).map((s, i) => (
              <li
                key={`${s.dimensionKey}-${i}`}
                className="border-l-2 border-brand/40 pl-3"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  <span className="rounded bg-brand/15 px-1.5 py-0.5 font-medium text-brand">
                    {s.dimensionKey}
                  </span>
                  <span className="text-muted">
                    {dirLabel(s.direction)} · 材料度 {s.materiality}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink/85">{s.note}</p>
                <p className="text-[11px] leading-relaxed text-muted">
                  {s.newsTitle}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() =>
            update.mutate({
              entityId,
              reason: reason.trim() || null,
              dimensions: dims,
            })
          }
          className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
        >
          {update.isPending ? "保存中…" : dirty ? "保存" : "已保存"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => reset.mutate({ entityId })}
          className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink disabled:opacity-40"
          title="重置为解牛基础框架（清除你的重点/敏感度/静音）"
        >
          恢复默认
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => remove.mutate({ entityId })}
          className="ml-auto text-[11px] text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          取消采纳
        </button>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        你的逻辑更新于 {new Date(updatedAt).toISOString().slice(0, 10)}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        这是你自己的投资逻辑——解牛按你选的维度与敏感度帮你盯。非投资建议、不构成买卖依据、不预测涨跌。
      </p>
    </section>
  );
}
