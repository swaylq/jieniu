"use client";

import { api } from "~/trpc/react";

/** 首页顶部市场概览条：主要指数实时行情（红涨绿跌，只展示不预测）。数据失败则整条隐藏。 */
export function MarketStrip() {
  const { data, isPending } = api.quote.indices.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isPending) {
    return (
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <div className="no-scrollbar flex items-center gap-x-7 overflow-x-auto">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex shrink-0 items-baseline gap-2">
              <div className="h-3 w-14 animate-pulse rounded bg-muted/20" />
              <div className="h-3 w-16 animate-pulse rounded bg-muted/20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  return (
    <div className="relative rounded-xl border border-line bg-surface">
      <div className="no-scrollbar flex snap-x items-center gap-x-7 overflow-x-auto scroll-px-4 px-4 py-3">
        {data.map((idx) => {
          const up = idx.changePct >= 0;
          const tone = up ? "text-up" : "text-down";
          return (
            <div
              key={idx.symbol}
              className="flex shrink-0 snap-start items-baseline gap-2"
            >
              <span className="text-xs text-muted">{idx.label}</span>
              <span className={`tabular text-sm font-semibold ${tone}`}>
                {idx.price.toFixed(2)}
              </span>
              <span className={`tabular text-xs ${tone}`}>
                {up ? "+" : ""}
                {idx.changePct.toFixed(2)}%
              </span>
            </div>
          );
        })}
        <span className="ml-auto hidden shrink-0 text-[11px] text-muted sm:block">
          行情仅供参考
        </span>
      </div>
      {/* 移动端右侧渐隐：提示可横滑、且把裁切处收得干净（桌面全展开时隐藏） */}
      <div className="pointer-events-none absolute inset-y-px right-px w-10 rounded-r-xl bg-gradient-to-l from-surface to-transparent sm:hidden" />
    </div>
  );
}
