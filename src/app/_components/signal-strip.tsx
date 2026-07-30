// 个股结构化信号条（Phase1b）：融资余额 / 机构一致预期 / 下次限售解禁。
// 客观数据、中性色（铁律①红绿只给股价；铁律②机构预期只显覆盖数/评级分布，无目标价）。

type SignalItem = {
  kind: string;
  label: string;
  numValue: number | null;
  asOf: Date | string;
};

const KIND_LABEL: Record<string, string> = {
  consensus: "机构",
  margin: "两融",
  unlock: "解禁",
};
const ORDER = ["consensus", "margin", "unlock"];

export function SignalStrip({ signals }: { signals: SignalItem[] }) {
  if (!signals || signals.length === 0) return null;
  const sorted = [...signals].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <p className="mb-2 text-xs font-medium text-muted">
        资金 · 治理信号 · 客观数据
      </p>
      <ul className="space-y-1.5 text-xs">
        {sorted.map((s) => (
          <li key={s.kind} className="flex items-baseline gap-2">
            <span className="shrink-0 rounded bg-line/50 px-1.5 py-0.5 text-[10px] text-muted">
              {KIND_LABEL[s.kind] ?? s.kind}
            </span>
            <span className="text-ink/80">{s.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        数据来自东方财富，非评级、非投资建议
      </p>
    </div>
  );
}
