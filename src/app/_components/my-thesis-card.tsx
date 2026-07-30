"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { SignalLogItem } from "./signal-log";
import {
  personalizeSignals,
  SENSITIVITY_THRESHOLD,
  SENSITIVITY_LABEL,
  type Sensitivity,
  type UserDimension,
} from "~/lib/user-thesis";

type SignalItem = {
  dimensionKey: string;
  direction: string;
  materiality: number;
  note: string;
  newsTitle: string;
  newsId?: string | null;
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
  /** 刚保存过的短暂回执——让「点一下真的生效了」看得见。 */
  const [justSaved, setJustSaved] = useState(false);

  const update = api.userThesis.update.useMutation({
    onSuccess: () => {
      setDirty(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      // 整页刷新：提醒中心角标、信号条、组合视图都吃这份设置，不能只更新这张卡
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

  /**
   * 开关类改动（重点 / 静音 / 敏感度）**立即保存并刷新整页**——它们是离散选择，
   * 没有「还没想好」的中间态；而「我为什么持有」是自由文本，仍走显式保存。
   * 之前全都要按保存，点了没反应，用户以为旋钮是坏的。
   */
  function patchNow(key: string, p: Partial<UserDimension>) {
    const next = dims.map((d) => (d.key === key ? { ...d, ...p } : d));
    setDims(next);
    update.mutate({ entityId, reason: reason.trim() || null, dimensions: next });
  }

  /** 该维度在当前敏感度下，近期有几条信号够格提醒（分母是触及该维度的全部信号）。 */
  function dimStat(d: UserDimension) {
    const touched = signals.filter((s) => s.dimensionKey === d.key);
    const pass = touched.filter(
      (s) => s.materiality >= SENSITIVITY_THRESHOLD[d.sensitivity],
    );
    return { touched: touched.length, pass: pass.length };
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-brand/30 bg-brand/[0.05] p-5">
      <div className="flex items-center gap-2">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
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
          placeholder="一句话写下你的核心理由，日后逻辑有变时对照当初判断。"
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
                onClick={() => patchNow(d.key, { priority: !d.priority })}
                disabled={busy}
                className={`text-sm leading-none ${d.priority ? "text-brand" : "text-muted/40 hover:text-muted"}`}
                aria-pressed={d.priority}
                title={d.priority ? "取消重点" : "标为重点"}
              >
                ★
              </button>
              <span className="text-sm font-medium text-ink">{d.key}</span>
              <button
                type="button"
                onClick={() => patchNow(d.key, { muted: !d.muted })}
                disabled={busy}
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
            <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
              <span className="mr-1 text-[11px] text-muted">敏感度</span>
              {SENS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy || d.muted}
                  onClick={() => patchNow(d.key, { sensitivity: s })}
                  title={`${SENSITIVITY_LABEL[s]}（材料度 ≥ ${SENSITIVITY_THRESHOLD[s]}）`}
                  className={`rounded-full px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
                    d.sensitivity === s
                      ? "bg-brand/20 font-medium text-brand"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {SENS_LABEL[s]}
                </button>
              ))}
              {/* 即时反馈：这一档到底意味着什么、在这只股上会捞到几条 */}
              {(() => {
                const st = dimStat(d);
                return (
                  <span className="ml-1 text-[11px] text-muted">
                    {d.muted
                      ? "已静音，不提醒"
                      : `${SENSITIVITY_LABEL[d.sensitivity]}（材料度 ≥ ${SENSITIVITY_THRESHOLD[d.sensitivity]}）· 近期 ${st.pass}/${st.touched} 条达标`}
                  </span>
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <h3 className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wide text-muted">
          <span>
            近期触及你的逻辑 · {shown.length}
            <span className="font-normal"> / 共 {signals.length} 条触及</span>
          </span>
          {justSaved ? (
            <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand">
              已保存，全站生效
            </span>
          ) : null}
          {update.isPending ? (
            <span className="text-[11px] font-normal text-muted">保存中…</span>
          ) : null}
        </h3>
        {shown.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted">
            {signals.length === 0
              ? "近期还没有信号触及这几个维度——解牛只在新闻真的打到你盯的维度上时才记一条，没有就是没有。"
              : `近期有 ${signals.length} 条触及你的维度，但都没达到你设的敏感度门槛。把相关维度调到「高」可以放宽到材料度 ${SENSITIVITY_THRESHOLD.high}。`}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {shown.slice(0, 8).map((s, i) => (
              <SignalLogItem key={`${s.dimensionKey}-${i}`} s={s} />
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
          {update.isPending ? "保存中…" : dirty ? "保存这段说明" : "已保存"}
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
