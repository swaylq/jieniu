/**
 * 「机构痕迹」卡 —— 服务端组件，零 JS。
 *
 * 它和上面的「资金」卡是两个物种，版式上必须让人一眼看出来：
 * 资金卡是**估算**（跨源能差 20 倍），这张卡是**交易所披露的原始事实**（有席位名、有日期、有出处）。
 * 所以这里不写任何免责口径式的软话，只写「披露了什么」。
 *
 * 两条不能拆的约束：
 *
 * ① **没有行就整块不渲染。** 全市场 5900 只里每天只有约 50 只会亮
 *    （2026-08-27 实测：龙虎榜机构席位 35 只、大宗机构专用 23 只、北向席位 25 只）。
 *    留一张写着「今日无机构痕迹」的常驻空卡，对 99% 的股票就是每天一行噪音
 *    ——观察卡那轮已经踩过这个坑（「空态四格全写未设置不是信息是噪音」）。
 *
 * ② **不许推断是哪类机构。** 交易所规则里「机构专用」只是一个固定公布名称
 *    （深交所《交易规则》5.4.7 / 上交所 5.4.8），**不列举机构类型**，而且这些席位
 *    没有任何 ID，跨日也追踪不了同一家。所以卡上写「公募在买」「险资进场」都是编。
 *    北向席位是唯一有真实席位代码的，所以它单独成行、名字照抄。
 */

import { TRACE_SOURCE, traceText, type Trace } from "~/lib/institutional-trace";

/** 同一天的多条痕迹并成一组，最新的在前。 */
function groupByDay(traces: Trace[]): { day: string; items: Trace[] }[] {
  const m = new Map<string, Trace[]>();
  for (const t of traces) {
    const arr = m.get(t.tradeDate) ?? [];
    arr.push(t);
    m.set(t.tradeDate, arr);
  }
  return [...m.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({ day, items }));
}

export function InstitutionalTraceCard({
  traces,
  maxDays = 4,
}: {
  traces: Trace[];
  maxDays?: number;
}) {
  if (!traces || traces.length === 0) return null;
  const days = groupByDay(traces).slice(0, maxDays);

  return (
    <section
      id="institutional"
      className="border-line bg-surface scroll-mt-4 rounded-xl border p-4 shadow-sm"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-ink text-base font-bold">机构痕迹</h2>
        <span className="text-faint text-[11px]">交易所披露</span>
      </div>
      <p className="text-muted mb-3 text-[12px] leading-relaxed">
        下面每一条都是交易所公布的席位级买卖，不是估算。
      </p>

      <ul className="space-y-3">
        {days.map(({ day, items }) => (
          <li key={day}>
            <p className="text-faint mb-1 text-[11px] tabular-nums">{day}</p>
            <ul className="space-y-1.5">
              {items.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted bg-line/50 mt-[2px] h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap">
                    {TRACE_SOURCE[t.kind]}
                  </span>
                  <span className="text-ink/85 min-w-0 text-[13px] leading-relaxed">
                    {traceText(t)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <p className="text-faint mt-3 text-[11px] leading-relaxed">
        「机构专用」是交易所对机构席位的固定公布名称，
        <span className="text-muted">不披露是哪一家、也不区分公募还是险资</span>
        ，且席位没有代码、跨日无法追踪同一家机构。北向的「沪股通专用 / 深股通专用」
        是另一回事，它有真实席位代码。
      </p>
    </section>
  );
}
