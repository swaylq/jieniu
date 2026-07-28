/**
 * COMPANY ↔ STOCK 配对。
 *
 * 数据模型把一家公司拆成两个实体：`COMPANY`（无 ticker，`Thesis` 挂在这边）与它 `ISSUES`
 * 出来的 `STOCK`（有 ticker，`EntitySignal`／行情挂在这边）。个股页早就用关系补齐了 ticker，
 * 但 `entity.signals` 仍只按单一 id 查——于是**公司页拿不到任何结构化信号**，
 * 而公司页恰恰是有投资逻辑的那些页。这里提供合并所需的纯函数。
 */

export type PairedSignal = {
  kind: string;
  label: string;
  numValue: number | null;
  detail: unknown;
  asOf: Date;
};

/**
 * 把配对两侧的信号合成一份：同 kind 只留 `asOf` 最新的一条，按 kind 升序稳定输出。
 * （两侧同 kind 同时有值属正常——采集按 STOCK 写，历史数据可能落在 COMPANY 上。）
 */
export function mergePairedSignals<T extends PairedSignal>(signals: T[]): T[] {
  const best = new Map<string, T>();
  for (const s of signals) {
    const cur = best.get(s.kind);
    if (!cur || s.asOf.getTime() > cur.asOf.getTime()) best.set(s.kind, s);
  }
  return [...best.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}
