import { NEAR_DAYS, type DisclosureNode } from "~/lib/earnings-calendar";

function fmtDeadline(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 催化日历（P5-9）：接下来的**确定性**关键节点——A 股法定财报披露截止日（可算、不编）+
 * 可选「你要盯的催化」（来自投资逻辑，无确定日期，诚实标注）。配色 amber/灰，非价格不涉红绿。
 */
export function CatalystCalendar({
  nodes,
  catalysts,
  title = "催化日历 · 接下来的节点",
}: {
  nodes: DisclosureNode[];
  catalysts?: string[];
  title?: string;
}) {
  if (nodes.length === 0 && (!catalysts || catalysts.length === 0)) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <div className="flex items-center gap-2">
        <span aria-hidden>🗓️</span>
        <h2 className="text-base font-bold text-ink">{title}</h2>
      </div>

      {nodes.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {nodes.map((n) => {
            const near = n.daysUntil <= NEAR_DAYS;
            return (
              <li
                key={n.key}
                className="flex items-center gap-3 rounded-xl border border-line/70 bg-canvas px-3 py-2.5"
              >
                {/* 日期块每条都有 → 中性；琥珀留给下面条件触发的「临近」，那才是要跳出来的信号 */}
                <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-line/60 py-1 text-ink">
                  <span className="tabular text-sm font-bold">
                    {fmtDeadline(n.deadline)}
                  </span>
                  <span className="text-[10px]">最晚</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {n.label}披露
                    </span>
                    {near ? (
                      <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                        临近
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-muted">{n.period}</p>
                </div>
                <span className="tabular shrink-0 text-xs text-muted">
                  还有 {n.daysUntil} 天
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {catalysts && catalysts.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-xs font-semibold text-muted">
            你要盯的催化（来自投资逻辑，暂无确定日期）
          </h3>
          <ul className="mt-1.5 space-y-1">
            {catalysts.map((c, i) => (
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

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        以上为 A 股法定披露截止日（确定性节点，个股常提前披露）；个股确切财报日 / 解禁到期日需结构化日程源，暂未接入，不臆测。
      </p>
    </section>
  );
}
