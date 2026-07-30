import Link from "next/link";

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
 *
 * 可点开研报（sway 2026-07-29「这个点不了」）：给了 `reportsHref` + `reportCount>0`
 * 时，比例条整块变成通往个股页「研报」tab 的链接。**措辞上不能把两者说成一回事**——
 * 评级分布是东财汇总的第三方口径，研报清单只记录「哪家机构哪天发了什么主题」、
 * 不含结论，所以链接写「机构研报 N 篇」而不是「这 11 篇买入研报」。
 * 无研报入库的股（有一致预期的 2004 只里占七成）不给链接，不做点进空页的入口。
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
  reportsHref,
  reportCount = 0,
}: {
  detail: ConsensusDetail;
  asOf: Date | string;
  title?: string;
  /** 「研报」tab 地址；与 reportCount>0 同时给出才渲染成链接 */
  reportsHref?: string;
  /** 这家在库的机构研报篇数（0 = 不给入口，避免点进空列表） */
  reportCount?: number;
}) {
  const slices = ratingBreakdown(detail);
  const eps = epsOutlook(detail);
  if (slices.length === 0) return null;

  const linkable = Boolean(reportsHref) && reportCount > 0;

  // 比例条 + 图例：可点时整块套 <Link>（<a> 里放 ul 合法，内部无交互元素）。
  const breakdown = (
    <>
      <div className="bg-line/60 flex h-2 w-full overflow-hidden rounded-full">
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
            <span className="tabular text-ink font-semibold">{s.count}</span>
            <span className="tabular text-muted">({s.pct}%)</span>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <section className="border-line bg-surface rounded-xl border p-4">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="bg-brand h-5 w-1.5 rounded-full" aria-hidden />
        <h2 className="text-ink text-base font-bold">{title}</h2>
      </div>
      <p className="text-muted mb-3 text-xs">
        <span className="tabular text-ink font-semibold">{detail.orgNum}</span>{" "}
        家机构覆盖 · 数据截至 {fmtDate(asOf)}
      </p>

      {/* 分歧度比例条：一条堆叠条看清机构口径有多集中；有研报时整块可点 */}
      {linkable ? (
        <Link
          href={reportsHref!}
          className="group hover:bg-brand/[0.07] -mx-2 block rounded-lg px-2 py-1.5 transition-colors"
        >
          {breakdown}
          <span className="text-brand mt-2 flex items-center gap-1 text-xs font-medium">
            看这家的机构研报
            <span className="tabular">{reportCount}</span> 篇
            <span
              className="transition-transform group-hover:translate-x-0.5"
              aria-hidden
            >
              →
            </span>
          </span>
        </Link>
      ) : (
        breakdown
      )}

      {eps.length > 0 ? (
        <div className="border-line/70 mt-3 border-t pt-3">
          <p className="text-muted mb-1.5 text-xs font-medium">每股收益预期</p>
          <ul className="space-y-1 text-xs">
            {eps.map((e) => (
              <li
                key={e.year}
                className="flex items-baseline justify-between gap-2"
              >
                <span className="tabular text-muted">{e.year}</span>
                <span className="flex items-baseline gap-2">
                  <span className="tabular text-ink font-semibold">
                    {e.eps}
                  </span>
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

      <p className="text-muted mt-3 text-[10px] leading-relaxed">
        搬运东方财富汇总的第三方机构口径，非评级、非投资建议；不含目标价，也不代表解牛观点。
        {linkable
          ? "研报清单只记录「哪家机构在哪天发了什么主题」，与上面的评级分布并非一一对应。"
          : null}
      </p>
    </section>
  );
}
