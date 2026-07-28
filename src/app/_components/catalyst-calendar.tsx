import Link from "next/link";
import { NEAR_DAYS, type DisclosureNode } from "~/lib/earnings-calendar";
import { parseLocalDay, type AppointmentView } from "~/lib/disclosure";

function fmtDeadline(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 催化日历（P5-9）：接下来的**确定性**关键节点。
 *
 * 两档精度，就近取优：
 *  ① 预约披露日——交易所预约披露时间表（公司自己报备，精确到天，有改期留痕）。借鉴富途
 *     「牛牛财报站」头部的财报倒计时；接入前解牛只能给 ② 那档。
 *  ② A 股法定披露截止日（年报 4/30、半年报 8/31、三季报 10/31，可算、不编）——没有 ① 时兜底。
 * 外加可选「你要盯的催化」（来自投资逻辑，无确定日期，诚实标注）。
 * 配色 amber/灰，非价格不涉红绿。
 */
export function CatalystCalendar({
  nodes,
  catalysts,
  appointment,
  now = new Date(),
  previewHref,
  title = "催化日历 · 接下来的节点",
}: {
  nodes: DisclosureNode[];
  catalysts?: string[];
  appointment?: AppointmentView;
  now?: Date;
  /** 有预约披露日时，通往该股财报前瞻页的入口。不传就不出链接（别给死链）。 */
  previewHref?: string;
  title?: string;
}) {
  // 预约日已过却还没披露的不显示——挂着一个过去的节点比没有更糟。
  const apptDate = appointment ? parseLocalDay(appointment.date) : null;
  const apptDays = apptDate
    ? Math.round(
        (new Date(apptDate.getFullYear(), apptDate.getMonth(), apptDate.getDate()).getTime() -
          new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
          DAY_MS,
      )
    : null;
  const appt =
    appointment && apptDate && apptDays !== null && apptDays >= 0
      ? { ...appointment, at: apptDate, daysUntil: apptDays }
      : null;

  if (!appt && nodes.length === 0 && (!catalysts || catalysts.length === 0))
    return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <div className="flex items-center gap-2">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
        <h2 className="text-base font-bold text-ink">{title}</h2>
      </div>

      {appt ? (
        <ul className="mt-3">
          <li className="flex items-center gap-3 rounded-xl border border-brand/30 bg-brand/[0.04] px-3 py-2.5">
            {/* 精确日期用琥珀底板与法定最晚日区分开：这一档是公司报备的确定日程 */}
            <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-brand/15 py-1 text-brand">
              <span className="tabular text-sm font-bold">
                {pad2(appt.at.getMonth() + 1)}/{pad2(appt.at.getDate())}
              </span>
              <span className="text-[10px]">预约</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">
                  {appt.periodLabel}预约披露
                </span>
                {appt.daysUntil <= NEAR_DAYS ? (
                  <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                    临近
                  </span>
                ) : null}
                {appt.rescheduled ? (
                  <span className="rounded bg-line/70 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                    已改期
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-muted">交易所预约披露时间表</p>
            </div>
            <span className="tabular shrink-0 text-xs text-muted">
              还有 {appt.daysUntil} 天
            </span>
          </li>
        </ul>
      ) : null}

      {appt && previewHref ? (
        <Link
          href={previewHref}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand transition-opacity hover:opacity-80"
        >
          财报前瞻 · 这次要看什么
          <span aria-hidden>→</span>
        </Link>
      ) : null}

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
        {appt
          ? "预约披露日来自交易所预约披露时间表（公司报备，可改期）；「最晚」行为 A 股法定披露截止日。均为确定性日程，不预测披露时点。"
          : "以上为 A 股法定披露截止日（确定性节点，个股常提前披露）；个股确切财报日 / 解禁到期日需结构化日程源，暂未接入，不臆测。"}
      </p>
    </section>
  );
}
