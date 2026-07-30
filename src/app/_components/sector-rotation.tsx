import Link from "next/link";
import type { RankedSector, Discovery } from "~/lib/rotation";
import { splitNameCode } from "~/lib/watch-label";
import { HoverPrefetchLink } from "./hover-prefetch-link";

/**
 * 板块轮动 / 个股发现（A 股）。
 *
 * 配色分工是有意的：
 *  · **涨跌幅**用真实价格色（`text-up` / `text-down`）——它就是股价，红绿在这里是对的。
 *  · **主力净流入**用中性色 + 「净流入/净流出」文字——它是资金**流向**不是价格，
 *    染成红绿会被读成买卖信号（铁律①：红绿只给真实价格涨跌）。
 *  · 「共振/共跌/分化」用 amber/灰阶——它描述的是成分股步调是否一致，不是方向建议。
 */

/** 代表股 / 个股都带上自己的实体 id——**代码和名称一起**链到个股页（sway：点名称也要能进去）。 */
type LeaderRow = RankedSector["leaders"][number] & { entityId: string | null };
type SectorRow = Omit<RankedSector, "leaders"> & {
  sectorId: string | null;
  leaders: LeaderRow[];
};
type DiscoveryRow = Discovery & {
  sectorId: string | null;
  /** 个股自己的实体 id——链到个股页，不是板块页。 */
  entityId: string | null;
};

/**
 * 一个可点的标的：代码 + 名称同在一个链接里。
 * 名称里的 `(6位代码)` 剥掉——代码已经单独显示在前面，再带一遍是重复
 * （代码本该是字段而不是名字里的字符串，同 `lib/watch-label` 那条）。
 * 拿不到实体 id 就退化成纯文本，绝不产生 `/entity/null` 这种死链。
 */
function StockLink({
  entityId,
  code,
  name,
}: {
  entityId: string | null;
  code?: string;
  name: string;
}) {
  const label = splitNameCode(name).name;
  const body = (
    <>
      {code ? (
        <span className="tabular text-sm font-bold">{code}</span>
      ) : null}
      <span className={code ? "text-sm" : undefined}>{label}</span>
    </>
  );
  if (!entityId) {
    return (
      <span className="text-ink inline-flex items-baseline gap-2">{body}</span>
    );
  }
  return (
    <HoverPrefetchLink
      href={`/entity/${entityId}`}
      className="text-brand hover:text-brand-dark inline-flex items-baseline gap-2 transition-colors"
    >
      {body}
    </HoverPrefetchLink>
  );
}

function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

function yi(n: number): string {
  const v = n / 1e8;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}亿`;
}

function Pct({ v }: { v: number }) {
  const up = v >= 0;
  return (
    <span className={`tabular font-semibold ${up ? "text-up" : "text-down"}`}>
      {up ? "+" : ""}
      {v.toFixed(2)}%
    </span>
  );
}

const SIGNAL_CLS: Record<string, string> = {
  共振: "bg-brand/15 text-brand",
  共跌: "bg-line/70 text-muted",
  分化: "bg-line/50 text-muted",
};

function Foot({ asOf, extra }: { asOf: Date | string | null; extra: string }) {
  return (
    <p className="mt-3 text-[11px] leading-relaxed text-muted">
      {asOf ? `数据截至 ${fmtDate(asOf)} · ` : ""}
      主力资金为东方财富按成交单笔金额分档的计算口径，非交易所披露数据。{extra}
    </p>
  );
}

export function SectorRotation({
  sectors,
  asOf,
  title = "板块轮动",
}: {
  sectors: SectorRow[];
  asOf: Date | string | null;
  title?: string;
}) {
  if (sectors.length === 0) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <span className="rounded-full bg-line/60 px-1.5 text-[10px] text-muted">
            {sectors.length}
          </span>
        </div>
        <span className="text-[11px] text-muted">
          按 步调一致度 · 资金流 · 涨跌幅 名次和排序
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        {/* 整表 nowrap：这是一张数据表，外层已有 overflow-x-auto。允许折行的话，
            窄屏会把「半导体」竖成三行、「板块共跌」竖成四行，而不是横向滚动。 */}
        <table className="w-full min-w-[34rem] text-xs whitespace-nowrap">
          <thead>
            <tr className="text-left text-muted">
              <th className="pb-1.5 font-medium">板块</th>
              <th className="pb-1.5 text-right font-medium">均涨跌</th>
              <th className="pb-1.5 text-right font-medium">联动</th>
              <th className="pb-1.5 text-right font-medium">主力净流入</th>
              <th className="pb-1.5 pl-3 font-medium">信号</th>
              <th className="pb-1.5 pl-3 font-medium">主力资金前三</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {sectors.map((s) => (
              <tr key={s.sector}>
                <td className="py-2 font-semibold text-ink">
                  {s.sectorId ? (
                    <Link
                      href={`/entity/${s.sectorId}`}
                      className="transition-colors hover:text-brand"
                    >
                      {s.sector}
                    </Link>
                  ) : (
                    s.sector
                  )}
                </td>
                <td className="py-2 text-right">
                  <Pct v={s.avgChangePct} />
                </td>
                <td className="tabular py-2 text-right text-muted">
                  {s.up}↑{s.down}↓
                </td>
                {/* 中性色：资金流向不是价格 */}
                <td className="tabular py-2 text-right font-semibold text-ink">
                  {yi(s.netInflow)}
                </td>
                <td className="py-2 pl-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${SIGNAL_CLS[s.signal] ?? ""}`}
                  >
                    板块{s.signal}
                  </span>
                </td>
                <td className="text-muted py-2 pl-3">
                  {s.leaders.map((l, i) => (
                    <span key={l.code}>
                      {i > 0 ? "、" : ""}
                      {/* 代表股也带上代码（张楚寒：「现在有的公司有代码有的没有，不然都加上代码吧」）——
                          `l.code` 本来就在行里（它是 key），只是没往下传。 */}
                      <StockLink
                        entityId={l.entityId}
                        code={l.code}
                        name={l.name}
                      />
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Foot
        asOf={asOf}
        extra="「共振/共跌」描述成分股步调是否一致，是对已发生行情的客观描述，非投资建议、不预测涨跌。"
      />
    </section>
  );
}

export function StockDiscovery({
  items,
  asOf,
  title = "个股发现",
}: {
  items: DiscoveryRow[];
  asOf: Date | string | null;
  title?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <span className="rounded-full bg-line/60 px-1.5 text-[10px] text-muted">
            {items.length}
          </span>
        </div>
        <span className="text-[11px] text-muted">来自上方轮动板块</span>
      </div>

      <ul className="mt-3 space-y-2">
        {items.map((s) => (
          <li
            key={s.code}
            className="rounded-xl border border-line/70 bg-canvas px-3 py-2.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <StockLink entityId={s.entityId} code={s.code} name={s.name} />
              <span className="flex items-baseline gap-3">
                <Pct v={s.changePct} />
                <span className="tabular text-xs text-muted">{s.price}</span>
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              涨{s.changePct.toFixed(1)}% · 主力净流入{yi(s.netInflow)} · 板块：
              {s.sectorId ? (
                <Link
                  href={`/entity/${s.sectorId}`}
                  className="text-brand transition-opacity hover:opacity-80"
                >
                  {s.sector}
                </Link>
              ) : (
                s.sector
              )}
            </p>
          </li>
        ))}
      </ul>

      <Foot asOf={asOf} extra="仅为客观统计的筛选结果，不构成投资建议、不预测涨跌。" />
    </section>
  );
}
