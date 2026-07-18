"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { dirLabel } from "~/lib/thesis-status";

type Picked = { id: string; name: string; type: string; ticker: string | null };

const TYPE_LABEL: Record<string, string> = {
  STOCK: "股票",
  COMPANY: "公司",
  SECTOR: "板块",
  PERSON: "人物",
};

/**
 * 单股激活 onboarding（S2）：搜一只真实持仓 → 持仓/观察 + 一句理由 → 采纳其 thesis →
 * 立刻回填「过去 30 天几条动态触及你的逻辑」→ 落到该标的逻辑档案（而非泛资讯流 /feed）。
 */
export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [status, setStatus] = useState<"HOLDING" | "WATCH">("HOLDING");
  const [reason, setReason] = useState("");

  const results = api.entity.search.useQuery(
    { q },
    { enabled: q.trim().length > 0, staleTime: 10_000 },
  );
  const upsert = api.portfolio.upsert.useMutation();
  const adopt = api.userThesis.adopt.useMutation();
  const track = api.analytics.track.useMutation();
  const demo = api.userThesis.activationDemo.useQuery(
    { entityId: picked?.id ?? "" },
    { enabled: step === 3 && !!picked },
  );

  const activating = upsert.isPending || adopt.isPending;

  async function activate() {
    if (!picked) return;
    await upsert.mutateAsync({ entityId: picked.id, status });
    try {
      await adopt.mutateAsync({
        entityId: picked.id,
        reason: reason.trim() || null,
      });
    } catch {
      // 该标的暂无基础框架：仅加入组合，演示会给出相应文案。
    }
    track.mutate({ type: "onboarding_follow" });
    setStep(3);
  }

  const dots = (
    <div className="mb-5 flex items-center gap-2">
      {[1, 2, 3].map((s) => (
        <span
          key={s}
          className={`h-1.5 rounded-full transition-all ${
            s === step
              ? "w-6 bg-brand"
              : s < step
                ? "w-1.5 bg-brand/50"
                : "w-1.5 bg-line"
          }`}
        />
      ))}
    </div>
  );

  if (step === 1) {
    return (
      <div>
        {dots}
        <h1 className="text-xl font-bold text-ink">
          先加一只你真正持有或在盯的股
        </h1>
        <p className="mt-1 text-sm text-muted">
          解牛不铺全市场——从你在乎的一只开始，帮你盯住它的投资逻辑有没有变。
        </p>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜股票名 / 代码，如 兆易创新 / 603986"
          className="mt-4 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none"
        />
        <div className="mt-3 space-y-1.5">
          {q.trim() && results.isFetching && !results.data ? (
            <p className="text-sm text-muted">搜索中…</p>
          ) : null}
          {results.data?.length === 0 && q.trim() ? (
            <p className="text-sm text-muted">
              没找到「{q}」。解牛目前聚焦最热门板块的核心标的，换个名字或代码试试。
            </p>
          ) : null}
          {results.data?.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setPicked(e);
                setStep(2);
              }}
              className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-brand"
            >
              <span className="text-sm font-medium text-ink">{e.name}</span>
              {e.ticker ? (
                <span className="tabular text-xs text-muted">{e.ticker}</span>
              ) : null}
              <span className="ml-auto rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
                {TYPE_LABEL[e.type] ?? e.type}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-6 text-xs text-muted hover:text-ink"
        >
          先逛逛，稍后再说
        </button>
      </div>
    );
  }

  if (step === 2 && picked) {
    return (
      <div>
        {dots}
        <h1 className="text-xl font-bold text-ink">{picked.name}</h1>
        <p className="mt-1 text-sm text-muted">
          告诉解牛你和它的关系，它会据此帮你盯。
        </p>

        <div className="mt-4">
          <p className="text-xs font-semibold text-muted">你是——</p>
          <div className="mt-2 flex gap-2">
            {(
              [
                ["HOLDING", "已持仓"],
                ["WATCH", "在观察"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setStatus(v)}
                className={`flex-1 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                  status === v
                    ? "border-brand bg-brand/10 font-medium text-brand"
                    : "border-line bg-surface text-muted hover:border-brand"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-semibold text-muted">
            一句话：你为什么{status === "HOLDING" ? "持有" : "关注"}它？
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="如：国产存储替代 + 车规放量，赌的是产品结构升级带动毛利。"
            className="mt-1 w-full resize-none rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-muted">
            这会成为你自己的投资逻辑锚点——日后逻辑有变，解牛帮你对照当初判断。
          </p>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-ink"
          >
            返回
          </button>
          <button
            type="button"
            disabled={activating}
            onClick={() => void activate()}
            className="flex-1 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {activating ? "激活中…" : "激活监控 →"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {dots}
      <h1 className="text-xl font-bold text-ink">已经盯上 {picked?.name} 了</h1>
      {demo.isLoading ? (
        <p className="mt-3 text-sm text-muted">正在回看过去 30 天…</p>
      ) : demo.data && demo.data.touchedCount > 0 ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink/90">
            过去 {demo.data.days} 天，有{" "}
            <strong className="text-brand">{demo.data.touchedCount}</strong>{" "}
            条动态触及你为它选的逻辑维度，其中{" "}
            <strong className="text-brand">{demo.data.wouldAlertCount}</strong>{" "}
            条达到会提醒你的级别。这就是解牛之后每天替你做的事。
          </p>
          {demo.data.samples.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {demo.data.samples.map((s, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-line/70 bg-surface p-3"
                >
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                    <span className="rounded bg-brand/15 px-1.5 py-0.5 font-medium text-brand">
                      {s.dimensionKey}
                    </span>
                    <span className="text-muted">
                      {dirLabel(s.direction)} · 材料度 {s.materiality}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink/85">
                    {s.note}
                  </p>
                  <p className="text-[11px] text-muted">{s.newsTitle}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-ink/90">
          解牛已经开始盯着 {picked?.name} 了。过去 30 天没有触及你逻辑的重大变化——
          <span className="text-muted">
            「没料不打扰」正是它的价值：只在你在乎的逻辑真的变了时才叫你。
          </span>
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={() => {
            setStep(1);
            setPicked(null);
            setQ("");
            setReason("");
          }}
          className="rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-ink"
        >
          再加一只
        </button>
        <button
          type="button"
          onClick={() => router.push(`/entity/${picked?.id}`)}
          className="flex-1 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          进入 {picked?.name} 的逻辑档案 →
        </button>
      </div>
    </div>
  );
}
