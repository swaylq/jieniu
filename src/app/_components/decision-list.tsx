import Link from "next/link";

import { ACTION_LABEL, actionTone, normalizeAction } from "~/lib/decision";
import { relativeTime } from "~/lib/format";

export type DecisionItem = {
  id: string;
  action: string;
  reason: string;
  price: number | null;
  createdAt: Date | string;
  entity?: { id: string; name: string } | null;
};

/** 决策时间线（P4-3，presentational）。动作标签用 amber(建仓侧)/灰(减仓侧)——非红绿、非涨跌。price 仅观察。 */
export function DecisionList({
  decisions,
  showEntity = false,
}: {
  decisions: DecisionItem[];
  showEntity?: boolean;
}) {
  if (decisions.length === 0) return null;
  return (
    <ul className="space-y-2.5">
      {decisions.map((d) => {
        const action = normalizeAction(d.action);
        const accent = actionTone(d.action) === "accent";
        return (
          <li key={d.id} className="border-l-2 border-brand/40 pl-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
              <span
                className={`rounded px-1.5 py-0.5 font-medium ${
                  accent ? "bg-brand/15 text-brand" : "bg-line/60 text-muted"
                }`}
              >
                {ACTION_LABEL[action]}
              </span>
              {showEntity && d.entity ? (
                <Link
                  href={`/entity/${d.entity.id}`}
                  className="font-medium text-ink hover:text-brand"
                >
                  {d.entity.name}
                </Link>
              ) : null}
              <span className="text-muted">{relativeTime(new Date(d.createdAt))}</span>
              {d.price != null ? (
                <span className="tabular text-muted">· 记价 {d.price}</span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink/85">{d.reason}</p>
          </li>
        );
      })}
    </ul>
  );
}
