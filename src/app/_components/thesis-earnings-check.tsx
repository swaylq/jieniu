import type { CheckableDimension } from "~/lib/earnings-check";

/**
 * 「这次财报会验证哪几条投资逻辑」——财报前瞻页的差异化模块。
 *
 * 富途的财报站围绕市场预期组织，解牛的锚是用户自己写下的 thesis：同一场财报，这里回答的是
 * 「它能验证/证伪你的哪几条」。这是富途结构上给不出的（它没有 thesis 这个对象）。
 *
 * 配色 amber/灰阶——逻辑校验不是涨跌，红绿只留给真实股价。
 * 命中的财务口径词直接标出来：筛选依据可见，用户能自己判断筛得对不对，不做黑箱。
 */
export function ThesisEarningsCheck({
  dimensions,
  source,
  periodLabel,
}: {
  dimensions: CheckableDimension[];
  source: "user" | "shared";
  periodLabel?: string;
}) {
  if (dimensions.length === 0) return null;
  const mine = source === "user";

  return (
    <section className="rounded-2xl border border-brand/25 bg-brand/[0.03] p-4 lg:p-5">
      <div className="flex items-center gap-2">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
        <h2 className="text-base font-bold text-ink">
          {mine
            ? "这次财报会验证你的哪几条逻辑"
            : "这次财报会验证这套框架的哪几条"}
        </h2>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {periodLabel ? `${periodLabel}发布后，` : "财报发布后，"}
        这 {dimensions.length} 条能拿到数据对照
        {mine ? "" : "（未采纳为你的逻辑前，这是共享的基础框架）"}。
      </p>

      <ul className="mt-3 space-y-3">
        {dimensions.map((d) => (
          <li
            key={d.key}
            className="rounded-xl border border-line/70 bg-canvas p-3"
          >
            <p className="text-sm font-semibold text-ink">{d.watch}</p>
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {d.matched.slice(0, 5).map((t) => (
                <li
                  key={t}
                  className="rounded bg-brand/12 px-1.5 py-0.5 text-[10px] font-medium text-brand"
                >
                  {t}
                </li>
              ))}
            </ul>
            {d.bull ? (
              <p className="mt-2 flex gap-1.5 text-xs leading-relaxed text-ink/85">
                <span className="shrink-0 font-semibold text-muted">兑现</span>
                <span>{d.bull}</span>
              </p>
            ) : null}
            {d.bear ? (
              <p className="mt-1 flex gap-1.5 text-xs leading-relaxed text-ink/85">
                <span className="shrink-0 font-semibold text-muted">恶化</span>
                <span>{d.bear}</span>
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        按财务口径关键词粗筛，只说明「财报能给出这几项数据」，不预判结果、不构成投资建议。
      </p>
    </section>
  );
}
