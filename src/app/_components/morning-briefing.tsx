import type { BriefingStats } from "~/lib/briefing";

/** 单张状态卡。铁律：强调色一律 amber，静态一律灰——方向靠 label/图标区分，不用红绿。 */
function StatCard({
  label,
  mark,
  value,
  caption,
  accent,
}: {
  label: string;
  mark: string;
  value: number;
  caption: string;
  accent: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border bg-surface p-4 ${
        accent && value > 0 ? "border-brand/40" : "border-line"
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        <span
          aria-hidden
          className={accent && value > 0 ? "text-brand" : "text-faint"}
        >
          {mark}
        </span>
        {label}
      </div>
      <div
        className={`tabular mt-1.5 text-3xl font-extrabold ${
          accent && value > 0 ? "text-brand" : "text-ink"
        }`}
      >
        {value}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">{caption}</p>
    </div>
  );
}

/**
 * 投资晨报（首页个人工作台头部，张楚寒 2026-07-13：首页要是工作台不是资讯流）。
 * 问候 + 主标题 + 副行 + 4 张状态卡，全部由真实持仓逻辑数据驱动、零行情数值。
 */
export function MorningBriefing({
  greeting,
  name,
  dateLabel,
  headline,
  subline,
  stats,
  upcomingCount,
}: {
  greeting: string;
  name: string | null;
  dateLabel: string;
  headline: string;
  subline: string;
  stats: BriefingStats;
  upcomingCount: number;
}) {
  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-[1.5px] text-brand">
        {dateLabel} · 投资晨报
      </p>
      <h1 className="mt-2 text-2xl font-extrabold leading-snug tracking-tight text-ink sm:text-[28px]">
        {greeting}
        {name ? (
          <>
            ，<span className="text-brand">{name}</span>
          </>
        ) : null}
        。{headline}
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{subline}</p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="需要复核"
          mark="↗"
          value={stats.review}
          caption="偏风险方向的逻辑变化，建议回看证伪条件"
          accent
        />
        <StatCard
          label="逻辑增强"
          mark="+"
          value={stats.strengthened}
          caption="偏兑现方向的动态在增多，对照持仓复核"
          accent
        />
        <StatCard
          label="今日静音"
          mark="✓"
          value={stats.muted}
          caption="无实质动态，已替你静音——宁静也是信号"
          accent={false}
        />
        <StatCard
          label="催化临近"
          mark="◎"
          value={upcomingCount}
          caption="近两周内的披露 / 财报节点，值得提前留意"
          accent={false}
        />
      </div>
    </section>
  );
}
