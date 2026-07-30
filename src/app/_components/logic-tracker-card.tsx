"use client";

import { useState } from "react";
import type { ThesisDimension } from "~/lib/thesis";
import {
  trackDimension,
  statusBadgeClass,
  type DimSignal,
} from "~/lib/logic-tracker";
import { impactBadgeClass } from "~/lib/logic-impact";
import { relativeTime } from "~/lib/format";
import { gradeLabel, type EvidenceGrade } from "~/lib/evidence";
import {
  SOURCE_LEVEL_SHORT,
  isHardSource,
  type SourceLevel,
} from "~/lib/evidence-source";
import {
  buildEvidenceDetail,
  type EvidenceDetail,
  type EvidenceSignal,
} from "~/lib/evidence-detail";
import { EvidenceDrawer } from "./evidence-drawer";

export type TrackerSignal = DimSignal & {
  dimensionKey: string;
  fact?: string;
  why?: string;
  grade?: string;
  newsTitle?: string;
  newsId?: string | null;
  sourceName?: string | null;
  tier?: string | null;
  sourceLevel?: SourceLevel;
};

/**
 * 逻辑追踪器（P5-7）：把「盯这几个维度」重构成显式追踪表——
 * 每个投资命题 | 当前状态(已验证/部分验证/待验证/未验证) | 变化(增强/削弱) | 最新证据。
 * 纯规则（`logic-tracker.ts`），零 AI；配色 amber/灰、无红绿。
 *
 * 2026-07-30（张楚寒）三处改动：
 * ① 「最新证据」整条**可点**，点开右侧证据抽屉（客观事实 / 为什么能验证该命题 / 影响判断）。
 *    他把这条称作「解牛的核心交互之一」——用户能核对证据，可信度才立得住。
 * ② 证据带**分级**标注（直接证据 / 旁证 + 六级来源等级）。旁证不是坏事，但用户有权知道
 *    这条不是关于这家公司的；真正不合格的（通用推测、市场传闻）在读路就被拦掉了。
 * ③ 模块改名为「**逻辑追踪器：证据如何改变投资判断**」，并把他要的那条链显式画出来：
 *    新闻 → 客观事实 → 对应命题 → 证据强度 → 逻辑增强或削弱。
 *    他的原话：「而不是简单把『最新证据』做成新闻链接。新闻可点击只是第一步。」
 */
export function LogicTracker({
  dims,
  signals,
}: {
  dims: ThesisDimension[];
  signals: TrackerSignal[];
}) {
  const [detail, setDetail] = useState<EvidenceDetail | null>(null);

  const byDim = new Map<string, TrackerSignal[]>();
  for (const s of signals) {
    const arr = byDim.get(s.dimensionKey) ?? [];
    arr.push(s);
    byDim.set(s.dimensionKey, arr);
  }
  const dimKeys = dims.map((d) => d.key);

  const open = (s: TrackerSignal) => {
    setDetail(buildEvidenceDetail(toEvidence(s), signals.map(toEvidence), dimKeys));
  };

  return (
    <div>
      <div className="mb-2">
        <h3 className="text-xs font-semibold tracking-wide text-ink">
          逻辑追踪器：证据如何改变投资判断
        </h3>
        {/* 他要的那条链，直接写在标题下面当作阅读说明——用户一眼知道这张表在干什么 */}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-muted">
          {["新闻", "客观事实", "对应命题", "证据强度", "逻辑增强或削弱"].map(
            (step, i) => (
              <span key={step} className="flex items-center gap-1">
                {i > 0 ? <span className="text-muted/50">→</span> : null}
                <span className={i === 3 ? "font-medium text-brand" : undefined}>
                  {step}
                </span>
              </span>
            ),
          )}
        </p>
      </div>
      {/* 桌面列头 */}
      <div className="hidden grid-cols-[1fr_auto_auto] gap-2 border-b border-line/60 px-3 pb-1.5 text-[11px] font-medium text-muted sm:grid">
        <span>投资命题</span>
        <span className="w-16 text-center">当前状态</span>
        <span className="w-20 text-center">变化</span>
      </div>
      <ul className="divide-y divide-line/60">
        {dims.map((d) => {
          const mine = byDim.get(d.key) ?? [];
          const t = trackDimension(mine);
          const latest = pickLatest(mine);
          return (
            <li key={d.key} className="px-1 py-2.5 sm:px-3">
              <div className="flex flex-wrap items-center gap-2 sm:grid sm:grid-cols-[1fr_auto_auto]">
                <span className="text-sm font-semibold text-ink">{d.key}</span>
                <span className="sm:w-16 sm:text-center">
                  {/* title 里放判定理由：「已验证」现在有硬门槛（一至三级来源 + 直接支持命题），
                      不说明凭什么，用户会以为是随机的 */}
                  <span
                    className={statusBadgeClass(t.statusTone)}
                    title={t.statusWhy}
                  >
                    {t.statusLabel}
                  </span>
                </span>
                <span className="sm:w-20 sm:text-center">
                  {/* 没有任何信号时不再显示「无实质影响」徽章——「未验证」状态已表达同一事实，
                      逐行重复只会把真正的内容(盯什么)淹掉。留一个破折号占位保持列对齐。 */}
                  {t.hitCount === 0 ? (
                    <span className="text-[11px] text-muted" aria-label="暂无变化">
                      —
                    </span>
                  ) : (
                    <span className={impactBadgeClass(t.impact.tone)}>
                      {t.impact.label}
                    </span>
                  )}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                盯：{d.watch}
              </p>
              {/* 无证据时不逐行写「暂无触及该命题的资讯」——「未验证」徽章已说明。
                  这里的「空」现在还多了一层含义：够格的证据一条都没有（通用推测已被判掉）。 */}
              {latest ? (
                <button
                  type="button"
                  onClick={() => open(latest)}
                  className="mt-1 block w-full rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-brand/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/40"
                  aria-label={`查看「${d.key}」最新证据的原始出处`}
                >
                  <span className="text-xs leading-relaxed text-ink/85">
                    <span className="text-muted">
                      最新证据
                      {latest.publishedAt
                        ? ` · ${relativeTime(new Date(latest.publishedAt))}`
                        : ""}
                      ：
                    </span>
                    {latest.fact ?? latest.note}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                    {/* 证据强度＝来源等级 × 直接性。一到三级用 amber 实心，四到六级留灰——
                        用户扫一眼就知道这条「已验证」是靠公告撑起来的还是靠一篇研报 */}
                    {latest.sourceLevel ? (
                      <span
                        className={
                          isHardSource(latest.sourceLevel)
                            ? "rounded bg-brand/15 px-1.5 py-0.5 font-semibold text-brand"
                            : "rounded bg-line/60 px-1.5 py-0.5 font-medium"
                        }
                      >
                        {SOURCE_LEVEL_SHORT[latest.sourceLevel]}
                      </span>
                    ) : null}
                    {latest.grade ? (
                      <span className="rounded bg-line/60 px-1.5 py-0.5 font-medium">
                        {gradeLabel(latest.grade as EvidenceGrade)}
                      </span>
                    ) : null}
                    <span className="truncate">{latest.sourceName ?? ""}</span>
                    <span className="ml-auto shrink-0 text-brand">看证据 →</span>
                  </span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <EvidenceDrawer detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/** 最新证据 = publishedAt 最近的一条（与 `trackDimension` 同口径，但这里要带上整条以便开抽屉）。 */
function pickLatest(items: TrackerSignal[]): TrackerSignal | null {
  if (items.length === 0) return null;
  return [...items].sort(
    (a, b) => time(b.publishedAt) - time(a.publishedAt),
  )[0]!;
}

function time(d?: Date | string | null): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toEvidence(s: TrackerSignal): EvidenceSignal {
  return {
    dimensionKey: s.dimensionKey,
    direction: s.direction,
    materiality: s.materiality,
    fact: s.fact ?? s.note,
    why: s.why ?? "",
    grade: s.grade ?? "supporting",
    newsTitle: s.newsTitle ?? "",
    newsId: s.newsId ?? null,
    publishedAt: s.publishedAt,
    sourceName: s.sourceName,
    tier: s.tier,
    sourceLevel: s.sourceLevel,
  };
}
