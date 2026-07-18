import Link from "next/link";

import { classifyLogicImpact, impactBadgeClass } from "~/lib/logic-impact";

type LensSig = {
  dimensionKey: string;
  direction: string;
  materiality: number;
  note: string;
};
type LensGroup = { entityId: string; entityName: string; signals: LensSig[] };

/** thesis 感知解读（Phase 3 P3-8）：这条资讯动没动你监控的投资逻辑。复用 P3-3 预算好的信号，不再新调 AI。颜色只用 amber/灰。 */
export function ThesisLensCard({ groups }: { groups: LensGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section className="rounded-xl border border-brand/30 bg-brand/[0.05] p-4 lg:p-5">
      <div className="mb-1 flex items-center gap-2">
        <span aria-hidden>🎯</span>
        <h2 className="text-base font-bold text-ink">动没动你的逻辑</h2>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        这条资讯触及你监控的投资逻辑框架的哪些维度、偏兑现还是偏风险。
      </p>
      <div className="space-y-4">
        {groups.map((g) => {
          const topSig = g.signals.length
            ? g.signals.reduce((a, b) => (b.materiality > a.materiality ? b : a))
            : null;
          const topImp = topSig ? classifyLogicImpact(topSig) : null;
          return (
            <div key={g.entityId}>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/entity/${g.entityId}`}
                  className="text-sm font-semibold text-ink transition-colors hover:text-brand"
                >
                  {g.entityName}
                </Link>
                {topImp ? (
                  <span className={impactBadgeClass(topImp.tone)}>
                    对你的逻辑：{topImp.label}
                  </span>
                ) : null}
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {g.signals.map((s, i) => {
                  const imp = classifyLogicImpact(s);
                  return (
                    <li key={i} className="border-l-2 border-brand/40 pl-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                        <span className="rounded bg-brand/15 px-1.5 py-0.5 font-medium text-brand">
                          {s.dimensionKey}
                        </span>
                        <span className={impactBadgeClass(imp.tone)}>
                          {imp.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-ink/85">
                        {s.note}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        基于你的投资逻辑框架的客观匹配，非投资建议、不预测涨跌、不构成买卖依据。
      </p>
    </section>
  );
}
