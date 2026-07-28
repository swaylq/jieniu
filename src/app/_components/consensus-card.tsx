import {
  ratingBreakdown,
  epsOutlook,
  type ConsensusDetail,
  type RatingSliceKey,
} from "~/lib/consensus";

/**
 * 机构一致预期卡（借鉴富途「AI 大行观点」的分歧度比例条）。
 *
 * 富途把投行观点聚合成「超预期 100% / 不及预期 0%」一条比例条——AI 只做归纳计票、
 * 方向留给机构。这里是它的 A 股合规改写：搬运东财的评级分布做分歧度，
 * 再把一直没露出来的未来两年 EPS 一致预期补上。
 *
 * 配色铁律：比例条全部走 amber 深浅 + 灰阶；红绿只留给真实股价涨跌。
 * 隐含增速也用中性色——它是机构预期的算术结果，不是涨跌。
 */

const SLICE_BAR: Record<RatingSliceKey, string> = {
  buy: "bg-brand",
  add: "bg-brand/60",
  neutral: "bg-brand/30",
  other: "bg-line",
};
const SLICE_DOT: Record<RatingSliceKey, string> = {
  buy: "bg-brand",
  add: "bg-brand/60",
  neutral: "bg-brand/30",
  other: "bg-line",
};

function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
}

export function ConsensusCard({
  detail,
  asOf,
  title = "机构一致预期",
}: {
  detail: ConsensusDetail;
  asOf: Date | string;
  title?: string;
}) {
  const slices = ratingBreakdown(detail);
  const eps = epsOutlook(detail);
  if (slices.length === 0) return null;

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
        <h2 className="text-base font-bold text-ink">{title}</h2>
      </div>
      <p className="mb-3 text-xs text-muted">
        <span className="tabular font-semibold text-ink">{detail.orgNum}</span>{" "}
        家机构覆盖 · 数据截至 {fmtDate(asOf)}
      </p>

      {/* 分歧度比例条：一条堆叠条看清机构口径有多集中 */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-line/60">
        {slices.map((s) => (
          <div
            key={s.key}
            className={SLICE_BAR[s.key]}
            style={{ width: `${s.pct}%` }}
            aria-hidden
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${SLICE_DOT[s.key]}`}
              aria-hidden
            />
            <span className="text-muted">{s.label}</span>
            <span className="tabular font-semibold text-ink">{s.count}</span>
            <span className="tabular text-muted">({s.pct}%)</span>
          </li>
        ))}
      </ul>

      {eps.length > 0 ? (
        <div className="mt-3 border-t border-line/70 pt-3">
          <p className="mb-1.5 text-xs font-medium text-muted">每股收益预期</p>
          <ul className="space-y-1 text-xs">
            {eps.map((e) => (
              <li key={e.year} className="flex items-baseline justify-between gap-2">
                <span className="tabular text-muted">{e.year}</span>
                <span className="flex items-baseline gap-2">
                  <span className="tabular font-semibold text-ink">{e.eps}</span>
                  {e.growthPct !== null ? (
                    <span className="tabular text-muted">
                      较上年 {e.growthPct > 0 ? "+" : ""}
                      {e.growthPct}%
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        搬运东方财富汇总的第三方机构口径，非评级、非投资建议；不含目标价，也不代表解牛观点。
      </p>
    </section>
  );
}
