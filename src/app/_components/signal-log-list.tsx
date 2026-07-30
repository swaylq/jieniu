"use client";

import { useState } from "react";
import { dirLabel } from "~/lib/thesis-status";
import { gradeLabel, type EvidenceGrade } from "~/lib/evidence";
import {
  buildEvidenceDetail,
  type EvidenceDetail,
  type EvidenceSignal,
} from "~/lib/evidence-detail";
import { EvidenceDrawer } from "./evidence-drawer";

export type SignalLogRow = {
  dimensionKey: string;
  direction: string;
  materiality: number;
  note: string;
  newsTitle: string;
  newsId?: string | null;
  publishedAt?: Date | string | null;
  fact?: string;
  why?: string;
  grade?: string;
  sourceName?: string | null;
  tier?: string | null;
};

/**
 * 「近期触及逻辑的动态」列表。整条可点 → 证据抽屉（与逻辑追踪器同一个交互）。
 *
 * 之前每条只有标题是链接、点了跳去 `/news`。张楚寒把「点证据看出处」称作解牛的核心交互之一，
 * 那它就该在**所有**出现证据的地方是同一个动作，而不是这里跳页、那里开抽屉。
 * 抽屉里仍有「查看原文」，想读全文的一步不多。
 */
export function SignalLogList({
  signals,
  dimKeys,
  max = 8,
}: {
  signals: SignalLogRow[];
  dimKeys: string[];
  max?: number;
}) {
  const [detail, setDetail] = useState<EvidenceDetail | null>(null);
  const all = signals.map(toEvidence);

  return (
    <>
      <ul className="space-y-2.5">
        {signals.slice(0, max).map((s, i) => (
          <li key={`${s.dimensionKey}-${i}`} className="border-l-2 border-line pl-3">
            <button
              type="button"
              onClick={() =>
                setDetail(buildEvidenceDetail(toEvidence(s), all, dimKeys))
              }
              className="block w-full rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-brand/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/40"
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                <span className="rounded bg-line/60 px-1.5 py-0.5 font-medium text-muted">
                  {s.dimensionKey}
                </span>
                <span className="text-muted">
                  {dirLabel(s.direction)} · 材料度 {s.materiality}
                </span>
                {s.grade ? (
                  <span className="text-muted">
                    · {gradeLabel(s.grade as EvidenceGrade)}
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-ink/85">
                {s.fact ?? s.note}
              </span>
              <span className="mt-0.5 flex items-center gap-2 text-[11px] leading-relaxed text-muted">
                <span className="line-clamp-1">{s.newsTitle}</span>
                <span className="ml-auto shrink-0 text-brand">看证据 →</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <EvidenceDrawer detail={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function toEvidence(s: SignalLogRow): EvidenceSignal {
  return {
    dimensionKey: s.dimensionKey,
    direction: s.direction,
    materiality: s.materiality,
    fact: s.fact ?? s.note,
    why: s.why ?? "",
    grade: s.grade ?? "supporting",
    newsTitle: s.newsTitle,
    newsId: s.newsId ?? null,
    publishedAt: s.publishedAt,
    sourceName: s.sourceName,
    tier: s.tier,
  };
}
