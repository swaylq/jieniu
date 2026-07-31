/**
 * 腾讯前复权日线解析（纯函数、无 IO、可测）。
 *
 * 为什么需要它：`MarketDaily` 原来只有**未复权**收盘价，导致三件事做不好——
 *  ① 一字板（开=收=高=低）判不了，只能在生成时对最终 ≤8 只单独拉 K 线，
 *     回测阶段因此完全不剔一字板，口径与线上不一致；
 *  ② 「机械性异动」只能用「收盘价跳变 >11%」这种粗判据，而 10 送 10 会造成 -50% 的跳变，
 *     那不是异动、是除权；
 *  ③ 展示「N 日前的价格」用的是未复权价。
 *
 * 腾讯 `fqkline` 一次给 320 根、**已前复权**、且带四价。
 * **字段序是 `[日期, 开, 收, 高, 低, 量]`**——不是 OHLC，认错会把收盘价当最高价，
 * 测试里用「高低必须包住开收」把它钉死。
 */

export type QfqBar = {
  day: string; // YYYY-MM-DD
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseTencentQfq(json: unknown, symbol: string): QfqBar[] {
  const data = (json as { data?: Record<string, { qfqday?: unknown }> } | null)?.data;
  const rows = data?.[symbol]?.qfqday;
  if (!Array.isArray(rows)) return [];
  const out: QfqBar[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 5) continue;
    const day = String(r[0] ?? "").slice(0, 10);
    if (!DAY_RE.test(day)) continue;
    const open = Number(r[1]);
    const close = Number(r[2]);
    const high = Number(r[3]);
    const low = Number(r[4]);
    const volume = Number(r[5] ?? 0);
    if (![open, close, high, low].every((v) => Number.isFinite(v) && v > 0))
      continue;
    out.push({
      day,
      open,
      close,
      high,
      low,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** 一字板：开=收=高=低。盘中有任何波动都不算——哪怕收在涨停价。 */
export function isOneWord(b: QfqBar): boolean {
  return b.open === b.close && b.close === b.high && b.high === b.low;
}

/**
 * 收盘价序列隐含的涨跌幅与官方上报涨跌幅的偏差（百分点）。
 * 前复权序列应当自洽（≈0）；偏差大说明这一天有复权/停牌/缩股之类的断裂。
 * 前收 ≤0 返回 null（除零会得到 Infinity）。
 */
export function gapVsReported(
  prevClose: number,
  close: number,
  reportedChangePct: number,
): number | null {
  if (!(prevClose > 0)) return null;
  return (close / prevClose - 1) * 100 - reportedChangePct;
}
