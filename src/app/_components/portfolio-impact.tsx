import Link from "next/link";

import { CHANGE_LABEL, changeTone, type ChangeDirection } from "~/lib/portfolio-change";
import { IMPACT_PATH_LABEL, type ImpactPath } from "~/lib/impact";

export type PortfolioImpactItem = {
  sourceEntityId: string;
  sourceName: string;
  direction: ChangeDirection;
  impacted: { entityId: string; name: string; path: ImpactPath }[];
};

/** Event 传播链（P4-9）：某持仓异动如何**间接**波及你其它持仓（同板块/竞品）。关联提示、非因果断言、非荐股。amber/灰。 */
export function PortfolioImpact({ items }: { items: PortfolioImpactItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <span aria-hidden>🕸️</span>
        <h2 className="text-base font-bold text-ink">这些异动可能波及你的其它持仓</h2>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        同板块 / 竞品关联的持仓，往往被同一条逻辑牵动——顺带提醒你别漏看，非因果断言、非买卖建议。
      </p>
      <ul className="mt-3 space-y-3">
        {items.map((it) => {
          const accent = changeTone(it.direction) === "accent";
          return (
            <li key={it.sourceEntityId} className="rounded-xl border border-line/70 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/entity/${it.sourceEntityId}`}
                  className="text-sm font-semibold text-ink hover:text-brand"
                >
                  {it.sourceName}
                </Link>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    accent ? "bg-brand/15 text-brand" : "bg-line/60 text-muted"
                  }`}
                >
                  {CHANGE_LABEL[it.direction]}
                </span>
                <span className="text-[11px] text-muted">可能波及 →</span>
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {it.impacted.map((h) => (
                  <li key={h.entityId}>
                    <Link
                      href={`/entity/${h.entityId}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg px-2 py-1 text-xs text-ink/85 transition-colors hover:border-brand/40 hover:text-brand"
                    >
                      <span className="font-medium">{h.name}</span>
                      <span className="text-[10px] text-muted">{IMPACT_PATH_LABEL[h.path]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        基于板块 / 关联关系的「值得留意」提示，帮你别漏看关联持仓；不代表必然联动、非投资建议、不预测涨跌。
      </p>
    </section>
  );
}
