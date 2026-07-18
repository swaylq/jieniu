"use client";

import { useState } from "react";

import { availableRanges, rangeValues } from "~/lib/spark";
import { Sparkline } from "./sparkline";

/**
 * 个股走势图：Robinhood 式时间药丸（1月/3月/6月/1年）+ 迷你走势图。
 * 传入一段较长的日线收盘序列，按档位在客户端切片重绘——纯历史展示，不预测。
 */
export function PriceChart({ values }: { values: number[] }) {
  const ranges = availableRanges(values.length);
  const initial =
    ranges.find((r) => r.key === "3M")?.key ??
    ranges[ranges.length - 1]?.key ??
    "1M";
  const [key, setKey] = useState(initial);

  if (ranges.length === 0) return null;
  const range = ranges.find((r) => r.key === key) ?? ranges[ranges.length - 1]!;
  const shown = rangeValues(values, range.days);

  return (
    <div>
      <Sparkline values={shown} ariaLabel={`近${range.label}走势`} />
      <div className="mt-1.5 flex items-center justify-end gap-1">
        {ranges.map((r) => {
          const active = r.key === key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => setKey(r.key)}
              aria-pressed={active}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-brand/10 text-brand"
                  : "text-muted hover:text-brand"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
