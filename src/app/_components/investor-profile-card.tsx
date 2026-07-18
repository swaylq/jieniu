"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import {
  STYLE_OPTIONS,
  RISK_OPTIONS,
  HOLD_OPTIONS,
} from "~/lib/investor-profile";

type Initial = {
  style: string | null;
  riskLevel: string | null;
  holdPeriod: string | null;
  summary: string | null;
} | null;

function PillRow({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: { value: string; label: string; hint: string }[];
  value: string | null;
  onPick: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.hint}
            onClick={() => onPick(o.value)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              value === o.value
                ? "bg-brand text-white"
                : "border border-line text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 投资画像卡（P4-6）：问卷 pills + AI 画像总结。自我认知镜子，非风险测评、非投资建议。amber/灰。 */
export function InvestorProfileCard({ initial }: { initial: Initial }) {
  const [style, setStyle] = useState<string | null>(initial?.style ?? null);
  const [risk, setRisk] = useState<string | null>(initial?.riskLevel ?? null);
  const [hold, setHold] = useState<string | null>(initial?.holdPeriod ?? null);
  const [summary, setSummary] = useState<string | null>(initial?.summary ?? null);
  const [tooFew, setTooFew] = useState(false);

  const save = api.investorProfile.save.useMutation();
  const summarize = api.investorProfile.summarize.useMutation({
    onSuccess: (res) => {
      setTooFew(res.tooFew);
      if (res.summary) setSummary(res.summary);
    },
  });

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span aria-hidden>🧭</span>
        <h2 className="text-sm font-bold text-ink">投资画像</h2>
        <span className="ml-auto text-[11px] text-muted">让提醒更懂你</span>
      </div>

      <div className="mt-3 space-y-3">
        <PillRow
          label="投资风格"
          options={STYLE_OPTIONS}
          value={style}
          onPick={(v) => {
            setStyle(v);
            save.mutate({ style: v });
          }}
        />
        <PillRow
          label="风险偏好"
          options={RISK_OPTIONS}
          value={risk}
          onPick={(v) => {
            setRisk(v);
            save.mutate({ riskLevel: v });
          }}
        />
        <PillRow
          label="持有周期"
          options={HOLD_OPTIONS}
          value={hold}
          onPick={(v) => {
            setHold(v);
            save.mutate({ holdPeriod: v });
          }}
        />
      </div>

      <div className="mt-3 rounded-lg border border-line/70 bg-canvas p-3">
        {summary ? (
          <p className="text-xs leading-relaxed text-ink/85">{summary}</p>
        ) : (
          <p className="text-xs leading-relaxed text-muted">
            {tooFew
              ? "决策记录还太少，先在个股页记几笔决策再生成（≥3 条）。"
              : "还没有画像总结。记录几笔决策后，让解牛从你的行为里归纳。"}
          </p>
        )}
        <button
          type="button"
          disabled={summarize.isPending}
          onClick={() => summarize.mutate()}
          className="mt-2 text-xs font-semibold text-brand hover:underline disabled:opacity-60"
        >
          {summarize.isPending
            ? "归纳中…"
            : summary
              ? "重新生成画像总结"
              : "从我的决策生成画像总结"}
        </button>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        画像是帮你认识自己的镜子，也让解牛的提醒与自查更懂你；非风险测评结论、非投资建议。
      </p>
    </section>
  );
}
