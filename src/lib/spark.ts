export type PriceRange = { key: string; label: string; days: number };

/** 走势图时间档位（按交易日近似：1月≈21、3月≈63、6月≈126、1年≈250）。 */
export const PRICE_RANGES: PriceRange[] = [
  { key: "1M", label: "1月", days: 21 },
  { key: "3M", label: "3月", days: 63 },
  { key: "6M", label: "6月", days: 126 },
  { key: "1Y", label: "1年", days: 250 },
];

/** 取序列末尾 days 个点（不足则全量）。 */
export function rangeValues(values: number[], days: number): number[] {
  return days >= values.length ? values : values.slice(values.length - days);
}

/** 依据数据点数量给出可用档位：数据比上一档覆盖的天数更多才显示该档，避免重复相同图。 */
export function availableRanges(len: number): PriceRange[] {
  return PRICE_RANGES.filter((r, i) =>
    i === 0 ? len >= 2 : len > PRICE_RANGES[i - 1]!.days,
  );
}

/** 把数值序列映射成 SVG 折线坐标：等距 x，按极差归一 y（顶部为最大值）。 */
export function sparklineCoords(
  values: number[],
  width: number,
  height: number,
  pad = 2,
): { x: number; y: number }[] {
  if (values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const stepX = width / (values.length - 1);
  const h = height - pad * 2;
  return values.map((v, i) => ({
    x: i * stepX,
    y: pad + (range === 0 ? h / 2 : h - ((v - min) / range) * h),
  }));
}
