import Link from "next/link";

/**
 * 市场强弱地图（需求 §1-1）。
 *
 * 它**只回答一个问题**：今天哪些行业强、哪些行业弱。
 * 刻意不出现「机会」两个字，也不做任何排序上的暗示——需求原话：
 * 「不得把所有强势或跌幅较大的行业自动称为机会」。真正的机会在下面那个模块里，
 * 要过完整的闸门才进得去。
 *
 * 配色沿用全站铁律：**红绿只给真实价格涨跌**；主力资金是流向不是价格，用中性色 + 文字。
 */

export type StrengthRow = {
  sector: string;
  sectorId: string;
  members: number;
  up: number;
  down: number;
  avgChangePct: number;
  amount: number | null;
  netAmount: number | null;
};

function yi(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const n = v / 1e8;
  if (Math.abs(n) >= 10000)
    return `${n >= 0 ? "+" : "-"}${(Math.abs(n) / 10000).toFixed(2)}万亿`;
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(1)}亿`;
}

function plainYi(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const n = v / 1e8;
  if (n >= 10000) return `${(n / 10000).toFixed(2)}万亿`;
  return `${n.toFixed(0)}亿`;
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

function Half({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: StrengthRow[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-ink text-sm font-semibold">{title}</h3>
        <span className="text-muted text-[11px]">{hint}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-xs whitespace-nowrap">
          <thead>
            <tr className="text-muted text-left">
              <th className="pb-1.5 font-medium">行业</th>
              <th className="pb-1.5 text-right font-medium">均涨跌</th>
              <th className="pb-1.5 text-right font-medium">涨/跌家数</th>
              <th className="pb-1.5 text-right font-medium">成交额</th>
              <th className="pb-1.5 text-right font-medium">主力资金</th>
            </tr>
          </thead>
          <tbody className="divide-line/70 divide-y">
            {rows.map((r) => (
              <tr key={r.sector}>
                <td className="text-ink py-2 font-semibold">
                  <Link
                    href={`/entity/${r.sectorId}`}
                    className="hover:text-brand transition-colors"
                  >
                    {r.sector}
                  </Link>
                  <span className="text-muted ml-1.5 text-[10px] font-normal">
                    {r.members}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <Pct v={r.avgChangePct} />
                </td>
                <td className="tabular text-muted py-2 text-right">
                  {r.up}↑{r.down}↓
                </td>
                <td className="tabular text-muted py-2 text-right">
                  {plainYi(r.amount)}
                </td>
                {/* 中性色：资金流向不是价格 */}
                <td className="tabular text-ink py-2 text-right font-semibold">
                  {yi(r.netAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MarketStrengthMap({
  sectors,
  tradeDate,
  take = 6,
}: {
  sectors: StrengthRow[];
  tradeDate: Date | string | null;
  take?: number;
}) {
  if (sectors.length === 0) return null;
  const strong = sectors.slice(0, take);
  const weak = [...sectors].slice(-take).reverse();
  const d = tradeDate
    ? typeof tradeDate === "string"
      ? tradeDate.slice(0, 10)
      : tradeDate.toISOString().slice(0, 10)
    : null;

  return (
    <section
      id="strength-map"
      className="border-line bg-surface rounded-2xl border p-4 lg:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="bg-brand h-5 w-1.5 rounded-full" aria-hidden />
          <h2 className="text-ink text-base font-bold">市场强弱地图</h2>
        </div>
        <span className="text-muted text-[11px]">
          今天哪些行业强、哪些行业弱 · 全 {sectors.length} 个行业
        </span>
      </div>

      {/* 两栏并排要到 2xl 才够宽：1440 屏减去 320 侧栏后每栏只剩 ~530px，
          五列表格会把「主力资金」整列切掉（实测截图发现）。 */}
      <div className="mt-4 grid gap-6 2xl:grid-cols-2">
        <Half title="强势一端" hint="按均涨跌排序" rows={strong} />
        <Half title="弱势一端" hint="按均涨跌排序" rows={weak} />
      </div>

      <p className="text-muted mt-4 text-[11px] leading-relaxed">
        {d ? `数据截至 ${d} 收盘 · ` : ""}
        这是对已发生行情的客观统计，<strong className="text-ink">不是机会列表</strong>——强势和跌幅大都不自动等于值得买。
        主力资金为按成交单笔金额分档的估算口径，非交易所披露数据。不构成投资建议。
      </p>
    </section>
  );
}
