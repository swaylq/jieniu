import Link from "next/link";

import { SectionHead } from "./section-head";

export type HotSectorItem = {
  sectorId: string;
  name: string;
  memberCount: number;
  heat7d: number;
  top: { id: string; name: string; heat: number }[];
};

/**
 * 「重点覆盖 · 热门板块」网格（张楚寒/GPT：先覆盖最热门板块最火的股票）。
 * discover 与首页登出态共用。纯展示、零 AI。
 * 热度用 amber(注意语义)而非红绿价格色；但只给板块内第一名，其余静默——见 DESIGN.md 强调色铁律。
 */
export function HotSectorGrid({
  sectors,
  totalStocks,
  compact = false,
}: {
  sectors: HotSectorItem[];
  totalStocks: number;
  /** compact=true：首页用，少一句说明。 */
  compact?: boolean;
}) {
  if (sectors.length === 0) return null;
  return (
    <section>
      <SectionHead
        title="重点覆盖 · 热门板块"
        hint={`${totalStocks} 只热门股 · ${sectors.length} 个板块`}
      />
      {compact ? null : (
        <p className="-mt-1 mb-3 text-xs text-muted">
          A股热门板块就那些——解牛先把每个热门板块里最火的龙头盯牢，而不是铺满全市场。板块内按近 7 天资讯热度排序。
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {sectors.map((s) => (
          <li
            key={s.sectorId}
            className="rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand/40"
          >
            <div className="flex items-baseline justify-between gap-2">
              <Link
                href={`/entity/${s.sectorId}`}
                className="font-bold text-ink hover:text-brand"
              >
                {s.name}
              </Link>
              <span className="tabular shrink-0 text-xs text-muted">
                {s.memberCount} 只 · 近 7 天 {s.heat7d} 条
              </span>
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {s.top.map((m, i) => (
                <li key={m.id}>
                  <Link
                    href={`/entity/${m.id}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-ink transition-colors hover:border-brand/50 hover:text-brand"
                  >
                    {m.name}
                    {m.heat > 0 ? (
                      // 只有本板块热度第一名用琥珀，其余静默：琥珀是「一屏一个焦点」的强调色，
                      // 每个 chip 都染色会把层级稀释成底噪。见 DESIGN.md「Identity color system」。
                      <span
                        className={`tabular text-[10px] ${
                          i === 0 ? "text-brand" : "text-faint"
                        }`}
                      >
                        {m.heat}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
