import Link from "next/link";

import {
  CHANGE_LABEL,
  type ChangeDirection,
  type PortfolioChangeItem,
} from "~/lib/portfolio-change";

export type CurrentCard = {
  entityId: string;
  name: string;
  /** 投资逻辑一句话核心判断（AI 生成，共享缓存）。无 thesis 则 null。 */
  summary: string | null;
  /** 逻辑验证进度：thesis 维度中近期有信号命中的比例（0-100，纯规则）。 */
  progress: number;
  dims: number;
  hitDims: number;
};

/** 逻辑变化方向 → 标签 + 色调（铁律：amber=增强，灰=风险/稳定/待验证，非红绿）。 */
function dirTag(d: ChangeDirection): { label: string; accent: boolean } {
  if (d === "strengthened") return { label: "增强 ↑", accent: true };
  if (d === "weakened") return { label: "风险 ↑", accent: false };
  return { label: "稳定 →", accent: false };
}

/**
 * 首页工作台右栏：当前投资卡（核心持仓的逻辑验证进度，无行情数值——缺行情不假装）+ 你的逻辑变化。
 */
export function WorkbenchRail({
  current,
  changes,
}: {
  current: CurrentCard | null;
  changes: PortfolioChangeItem[];
}) {
  return (
    <div className="space-y-4">
      {current ? (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">当前投资卡</h3>
            <Link
              href={`/entity/${current.entityId}`}
              className="shrink-0 text-xs font-medium text-brand hover:underline"
            >
              打开工作台 →
            </Link>
          </div>
          <p className="mt-2 text-sm font-semibold text-ink">{current.name}</p>
          {current.summary ? (
            <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">
              {current.summary}
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-muted">
              还没有投资逻辑框架——生成后即可开始逐条监控它是否被材料触及。
            </p>
          )}

          {current.dims > 0 ? (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">逻辑验证进度</span>
                <span className="tabular font-semibold text-ink">
                  {current.progress}%
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${current.progress}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                {current.dims} 个监控维度 · 近期已命中 {current.hitDims} 个 · 其余待验证
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {changes.length > 0 ? (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">你的逻辑变化</h3>
            <Link
              href="/profile"
              className="shrink-0 text-xs font-medium text-brand hover:underline"
            >
              全部 {changes.length} 项
            </Link>
          </div>
          <ul className="mt-2.5 space-y-2.5">
            {changes.map((c) => {
              const { label, accent } = dirTag(c.direction);
              return (
                <li key={c.entityId} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/entity/${c.entityId}`}
                      className="block truncate text-[13px] font-semibold text-ink hover:text-brand"
                    >
                      {c.name}
                      {c.topDimension ? (
                        <span className="font-normal text-muted"> · {c.topDimension}</span>
                      ) : null}
                    </Link>
                    <span className="line-clamp-1 text-[11px] text-muted">
                      {c.topNote || CHANGE_LABEL[c.direction]}
                    </span>
                  </div>
                  <span
                    className={`tabular shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      accent ? "bg-brand/15 text-brand" : "bg-line/60 text-muted"
                    }`}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
