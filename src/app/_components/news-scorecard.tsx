import type { Scorecard } from "~/lib/scorecard";

/**
 * 资讯记分卡卡片（Koyfin 分位记分卡的合规改写）：琥珀分位条 + 高/中/低 标签。
 * 纯展示——关于资讯覆盖/关注度的客观统计，非评级、非投资建议、不预测涨跌。
 */
export function NewsScorecard({ data }: { data: Scorecard }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
        <h2 className="text-base font-bold text-ink">资讯记分卡</h2>
      </div>
      <p className="mb-3 text-xs text-muted">{data.headline}</p>
      <div className="space-y-2.5">
        {data.entries.map((e) => (
          <div key={e.key}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-ink">{e.label}</span>
              <span className="text-muted">
                {e.note} ·{" "}
                <span className="font-semibold text-brand">{e.level}</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
              <div
                className="h-full rounded-full bg-brand/70"
                style={{ width: `${e.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        基于近 30 日资讯覆盖与多视角相关度的客观统计，非评级、非投资建议、不预测涨跌。
      </p>
    </section>
  );
}
