import Link from "next/link";

import { streamStamp } from "~/lib/format";
import { chipClass } from "./section-head";

type NewsLite = {
  id: string;
  title: string;
  publishedAt: Date;
  source: { name: string };
};
type PeerNews = NewsLite & { entityId: string; entityName: string };

/** 覆盖图谱（Phase 3 P3-5）：把公司所属行业 + 竞品的动态纳入监控视野。颜色只用 amber/灰。 */
export function EcosystemCoverage({
  sectors,
  peers,
  sectorNews,
  peerNews,
}: {
  sectors: { id: string; name: string }[];
  peers: { id: string; name: string; ticker: string | null }[];
  sectorNews: NewsLite[];
  peerNews: PeerNews[];
}) {
  if (sectors.length === 0 && peers.length === 0) return null;

  return (
    <section className="rounded-2xl border border-line/70 bg-surface p-5">
      <h2 className="text-base font-bold text-ink">行业与竞品</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        你在乎的公司所在行业 + 竞品的一举一动，一并纳入监控。
      </p>

      {sectors.length > 0 ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted">所属行业</span>
            {sectors.map((s) => (
              <Link key={s.id} href={`/entity/${s.id}`} className={chipClass}>
                {s.name}
              </Link>
            ))}
          </div>
          {sectorNews.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {sectorNews.map((n) => (
                <li key={n.id} className="flex items-baseline gap-2 text-xs">
                  <span className="tabular shrink-0 text-muted">
                    {streamStamp(n.publishedAt)}
                  </span>
                  <Link
                    href={`/news/${n.id}`}
                    className="line-clamp-1 text-ink transition-colors hover:text-brand"
                  >
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {peers.length > 0 ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted">竞品 · {peers.length}</span>
            {peers.map((p) => (
              <Link key={p.id} href={`/entity/${p.id}`} className={chipClass}>
                {p.name}
              </Link>
            ))}
          </div>
          {peerNews.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {peerNews.map((n, i) => (
                <li key={`${n.id}-${i}`} className="flex items-baseline gap-2 text-xs">
                  <Link
                    href={`/entity/${n.entityId}`}
                    className="shrink-0 rounded bg-line/60 px-1.5 py-0.5 font-medium text-ink transition-colors hover:bg-brand/15 hover:text-brand"
                  >
                    {n.entityName}
                  </Link>
                  <Link
                    href={`/news/${n.id}`}
                    className="line-clamp-1 text-ink transition-colors hover:text-brand"
                  >
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted">竞品近期无重磅 / 一手动态。</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
