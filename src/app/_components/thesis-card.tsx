import type { ThesisDimension } from "~/lib/thesis";
import {
  dirLabel,
  thesisActivityStatus,
  sortDimensionsByActivity,
} from "~/lib/thesis-status";
import { LogicTracker } from "./logic-tracker-card";

export type ThesisCardData = {
  summary: string;
  dimensions: ThesisDimension[];
  bullCase: string;
  bearCase: string;
  catalysts: string[]; // 关键催化剂（P4-2）
  invalidations: string[]; // 证伪条件（P4-2）
  keyLevels: string | null;
};

export type ThesisSignalItem = {
  dimensionKey: string;
  direction: string; // bull | bear | neutral
  materiality: number;
  note: string;
  newsTitle: string;
  publishedAt?: Date | string | null;
};

/** 投资逻辑框架卡（Phase 3 核心，P3-4 围绕 thesis 重构）。颜色只用 amber/灰阶——方向/材料度是论点非涨跌，不用红绿。 */
/** 生成日期披露（S4 信任）：YYYY-MM-DD，明确框架非实时。 */
function ymd(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

export function ThesisCard({
  name,
  data,
  signals = [],
  updatedAt,
}: {
  name: string;
  data: ThesisCardData;
  signals?: ThesisSignalItem[];
  updatedAt?: Date;
}) {
  const status = thesisActivityStatus(signals);
  const dims = sortDimensionsByActivity(data.dimensions, signals);

  return (
    <section className="overflow-hidden rounded-2xl border border-brand/30 bg-brand/[0.05] p-5">
      <div className="flex items-center gap-2">
        <span aria-hidden>🎯</span>
        <h2 className="text-base font-bold text-ink">投资逻辑 · {name}</h2>
        <span className="ml-auto shrink-0 text-[11px] text-muted">AI 生成 · 监控用</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink/90">{data.summary}</p>

      {/* 本周/近期状态：没料不打扰 */}
      {status.active ? (
        <div className="mt-3 rounded-xl border border-brand/30 bg-brand/10 px-3 py-2">
          <p className="text-xs font-semibold text-brand">{status.headline}</p>
          {status.top ? (
            <p className="mt-1 text-xs leading-relaxed text-ink/80">
              {status.top.note}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">{status.headline}</p>
      )}

      <div className="mt-4 rounded-xl border border-line/70 bg-surface p-3">
        <LogicTracker dims={dims} signals={signals} />
      </div>

      {/* 近期触及逻辑的动态（监控日志） */}
      {signals.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted">
            近期触及逻辑的动态 · {signals.length}
          </h3>
          <ul className="space-y-2.5">
            {signals.slice(0, 8).map((s, i) => (
              <li key={`${s.dimensionKey}-${i}`} className="border-l-2 border-brand/40 pl-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  <span className="rounded bg-brand/15 px-1.5 py-0.5 font-medium text-brand">
                    {s.dimensionKey}
                  </span>
                  <span className="text-muted">
                    {dirLabel(s.direction)} · 材料度 {s.materiality}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink/85">{s.note}</p>
                <p className="text-[11px] leading-relaxed text-muted">{s.newsTitle}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 预期差：市场在预期什么 vs 分歧在哪。诚实——不做估值高/低估的定量判断（需行情数据）。 */}
      <div className="mt-4">
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted">
            预期差 · 市场在预期什么
          </h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-brand/25 bg-brand/[0.05] p-3">
            <h4 className="text-xs font-semibold text-brand">市场共识</h4>
            <p className="mt-0.5 text-[11px] text-muted">多头在信什么</p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink/80">
              {data.bullCase}
            </p>
          </div>
          <div className="rounded-xl border border-line/70 bg-surface p-3">
            <h4 className="text-xs font-semibold text-ink">主要分歧</h4>
            <p className="mt-0.5 text-[11px] text-muted">空头担心什么</p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink/80">
              {data.bearCase}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          解牛不做「估值高估/低估、是否已price in」的定量判断（需行情与估值数据，暂缺）；这里帮你看清共识与分歧，配合上方追踪器看哪些命题已验证、哪些还没。
        </p>
      </div>

      {/* 催化剂 / 证伪条件：「什么会兑现逻辑 / 什么证明逻辑错了」——drift guard 的锚。amber/灰，不涉红绿 */}
      {data.catalysts.length > 0 || data.invalidations.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {data.catalysts.length > 0 ? (
            <div className="rounded-xl border border-brand/30 bg-brand/[0.06] p-3">
              <h4 className="text-xs font-semibold text-brand">关键催化剂</h4>
              <p className="mt-0.5 text-[11px] text-muted">什么发生，会兑现这条逻辑</p>
              <ul className="mt-2 space-y-1.5">
                {data.catalysts.map((c, i) => (
                  <li
                    key={i}
                    className="flex gap-1.5 text-xs leading-relaxed text-ink/85"
                  >
                    <span
                      className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand"
                      aria-hidden
                    />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.invalidations.length > 0 ? (
            <div className="rounded-xl border border-line/70 bg-surface p-3">
              <h4 className="text-xs font-semibold text-ink">证伪条件</h4>
              <p className="mt-0.5 text-[11px] text-muted">
                什么情况，说明逻辑被打破、该重审
              </p>
              <ul className="mt-2 space-y-1.5">
                {data.invalidations.map((c, i) => (
                  <li
                    key={i}
                    className="flex gap-1.5 text-xs leading-relaxed text-ink/85"
                  >
                    <span
                      className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted"
                      aria-hidden
                    />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {data.keyLevels ? (
        <div className="mt-3 rounded-xl border border-line/70 bg-surface p-3">
          <h4 className="text-xs font-semibold text-ink">关键价位（观察位）</h4>
          <p className="mt-1 text-xs leading-relaxed text-ink/80">{data.keyLevels}</p>
        </div>
      ) : null}

      {updatedAt ? (
        <p className="mt-4 text-[11px] text-muted">
          框架更新于 {ymd(updatedAt)} · 非实时，随重大变化再生成
        </p>
      ) : null}
      <p
        className={`${updatedAt ? "mt-1" : "mt-4"} text-[11px] leading-relaxed text-muted`}
      >
        投资逻辑框架由 AI 生成，仅用于帮你监控自己关心的维度；非投资建议、不构成买卖依据、不预测涨跌。
      </p>
    </section>
  );
}
