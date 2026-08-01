import { HoverPrefetchLink } from "./hover-prefetch-link";

/**
 * 「静默日」卡（2026-08-02 复盘）。
 *
 * 背景：7 个真实用户里 4 个只有 1 只自选，那只股整周都没有逻辑信号，
 * 于是首页只有一句「今天都很平静」——看起来像功能坏了，而不是像「今天确实没事」。
 *
 * 「没有新闻」不等于「没有信息」：机构一致预期、两融、解禁、资金流这些结构化事实一直都有，
 * 只是散在个股页里。安静的日子把它们摆出来，页面就有了不靠新闻的底。
 * 客观数据、中性色（铁律①红绿只给股价）、非评级非建议。
 */
const KIND_LABEL: Record<string, string> = {
  consensus: "机构",
  margin: "两融",
  unlock: "解禁",
  flow: "资金",
};
const ORDER = ["consensus", "flow", "margin", "unlock"];

export type QuietFact = { kind: string; label: string };
export type QuietRow = { entityId: string; name: string; facts: QuietFact[] };

export function QuietDayCard({ rows }: { rows: QuietRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-muted">
          今天没有新料，但这些是确定的
        </h2>
        <span className="ml-auto shrink-0 text-[11px] text-muted">
          客观数据 · 不依赖资讯
        </span>
      </div>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => {
          // 同一 kind 可能来自 COMPANY / STOCK 两份实体，去重后按固定顺序取前三条
          const seen = new Set<string>();
          const facts = [...r.facts]
            .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
            .filter((f) => (seen.has(f.kind) ? false : (seen.add(f.kind), true)))
            .slice(0, 3);
          return (
            <li key={r.entityId}>
              <HoverPrefetchLink
                href={`/entity/${r.entityId}`}
                className="text-sm font-semibold text-ink hover:text-brand"
              >
                {r.name}
              </HoverPrefetchLink>
              <ul className="mt-1 space-y-1">
                {facts.map((f) => (
                  <li key={f.kind} className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 rounded bg-line/50 px-1.5 py-0.5 text-[10px] text-muted">
                      {KIND_LABEL[f.kind] ?? f.kind}
                    </span>
                    <span className="text-ink/80">{f.label}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        数据来自东方财富，非评级、非投资建议、不预测涨跌。
      </p>
    </section>
  );
}
