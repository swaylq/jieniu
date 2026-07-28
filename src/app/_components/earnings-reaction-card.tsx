import { avgAbsOnDay, type Reaction, type ReactionDay } from "~/lib/earnings-reaction";

/**
 * 历史财报日反应卡（借鉴富途「历史财报日涨跌幅 · 近 4 次平均绝对值 ±7.26%」）。
 *
 * 作用是给一个**历史基线**：不懂财务的人也能知道「这家公司出财报那天通常动多大」。
 * 纯历史统计，不预测；平均绝对值不含方向，所以用中性色，只有逐次的真实涨跌用红绿。
 *
 * A 股特有的诚实处理：定期报告多在**盘后**披露，当日涨跌未必已反映财报，所以当日与次日并列。
 */

function fmtDay(day: string): string {
  const [, m, d] = day.split("-");
  return `${m}/${d}`;
}

function ChangeCell({ v }: { v: ReactionDay | null }) {
  if (!v) return <span className="tabular text-muted">—</span>;
  const up = v.changePct >= 0;
  return (
    <span className={`tabular font-semibold ${up ? "text-up" : "text-down"}`}>
      {up ? "+" : ""}
      {v.changePct.toFixed(2)}%
    </span>
  );
}

export function EarningsReactionCard({
  reactions,
  title = "历史财报日反应",
}: {
  reactions: Reaction[];
  title?: string;
}) {
  if (reactions.length === 0) return null;
  const avg = avgAbsOnDay(reactions);

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <div className="flex items-center gap-2">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
        <h2 className="text-base font-bold text-ink">{title}</h2>
      </div>

      {avg !== null ? (
        <p className="mt-2 text-xs text-muted">
          近 {reactions.length} 次披露日平均绝对波动{" "}
          <span className="tabular text-sm font-bold text-ink">±{avg}%</span>
          <span className="ml-1">（不含方向）</span>
        </p>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[20rem] text-xs">
          <thead>
            <tr className="text-left text-muted">
              <th className="pb-1.5 font-medium">报告期</th>
              <th className="pb-1.5 font-medium">披露日</th>
              <th className="pb-1.5 text-right font-medium">当日</th>
              <th className="pb-1.5 text-right font-medium">次一交易日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {reactions.map((r) => (
              <tr key={r.reportKey}>
                <td className="py-1.5 text-ink">{r.periodLabel}</td>
                <td className="tabular py-1.5 text-muted">
                  {fmtDay(r.disclosedOn)}
                </td>
                <td className="py-1.5 text-right">
                  <ChangeCell v={r.onDay} />
                </td>
                <td className="py-1.5 text-right">
                  <ChangeCell v={r.nextDay} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        A 股定期报告多在盘后披露，当日涨跌未必已反映财报，故与次一交易日并列。
        以上为已发生的历史统计，不预测本次涨跌，非投资建议。
      </p>
    </section>
  );
}
