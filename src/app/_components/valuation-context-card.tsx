import type { ValuationContext } from "~/lib/valuation-context";

/**
 * 估值对照卡（借鉴富途「公司估值」的分位 + 基准线做法）。
 *
 * 富途给的是「当前市盈率 66.6，超过历史（1年）27%」外加合理区间/行业均值/大盘三条基准。
 * 价值不在 66.6 这个数，而在**参照物**。解牛的估值卡此前只有单值，这里补上
 * 「自身历史分位」与「同行业中位数」两个锚。
 *
 * 配色 amber/灰阶——这是客观统计，不是涨跌，也不是「低估/高估」的判断。
 */
export function ValuationContextCard({
  ctx,
}: {
  ctx: ValuationContext | null;
}) {
  if (!ctx) return null;
  const pct = ctx.percentile;

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
        <h2 className="text-base font-bold text-ink">估值对照</h2>
      </div>
      <p className="mb-3 text-xs text-muted">
        市盈率 TTM{" "}
        <span className="tabular text-sm font-bold text-ink">
          {ctx.current.toFixed(2)}
        </span>
      </p>

      {pct !== null ? (
        <div className="mb-3">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted">
              超过历史 <span className="tabular">{ctx.sampleSize}</span> 个交易日的
            </span>
            <span className="tabular font-semibold text-brand">{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
            <div
              className="h-full rounded-full bg-brand/70"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}

      {ctx.industryMedian !== null ? (
        <div className="flex items-baseline justify-between gap-2 border-t border-line/70 pt-2.5 text-xs">
          <span className="text-muted">
            行业中位{ctx.boardName ? ` · ${ctx.boardName}` : ""}
          </span>
          <span className="tabular font-semibold text-ink">
            {ctx.industryMedian.toFixed(2)}
          </span>
        </div>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        分位为当前值在自身历史上的位置
        {ctx.industryMedian !== null ? "，同行中位已剔除亏损公司" : ""}
        。客观统计，非估值判断、非评级，不构成投资建议。
      </p>
    </section>
  );
}
