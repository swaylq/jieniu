"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { api } from "~/trpc/react";
import { type IndexMarket } from "~/lib/quote";

/** 市场分组标签与展示顺序（与服务端 INDEX_SYMBOLS 顺序一致）。 */
const MARKET_ORDER: IndexMarket[] = ["cn", "hk", "us"];
const MARKET_LABEL: Record<IndexMarket, string> = {
  cn: "沪深",
  hk: "港股",
  us: "美股",
};

/**
 * 首页顶部市场概览条：沪深 / 港股 / 美股主要指数（红涨绿跌，只展示不预测）。
 * 按市场分组标注——港美在 A 股交易时段显示的是上一交易日收盘，分组后不会被误读成实时。
 * 数据失败则整条隐藏。
 */
export function MarketStrip() {
  const { data, isPending } = api.quote.indices.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // 覆盖三个市场后条目会横向溢出（桌面端也会）。渐隐提示按「实际是否溢出」显示，
  // 而不是写死移动端断点——否则桌面用户根本不知道右边还有港股/美股。
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  if (isPending) {
    return (
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <div className="no-scrollbar flex items-center gap-x-6 overflow-x-auto">
          {Array.from({ length: 6 }).map((_, i) => (
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

  const groups = MARKET_ORDER.map((market) => ({
    market,
    items: data.filter((d) => d.market === market),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="relative rounded-xl border border-line bg-surface">
      <div
        ref={scrollerRef}
        className="no-scrollbar flex snap-x items-center gap-x-4 overflow-x-auto scroll-px-4 px-4 py-3"
      >
        {groups.map((g, gi) => (
          <Fragment key={g.market}>
            {gi > 0 ? (
              <span className="h-3.5 w-px shrink-0 bg-line" aria-hidden />
            ) : null}
            <div className="flex shrink-0 snap-start items-center gap-x-4">
              <span className="shrink-0 text-[11px] font-medium text-faint">
                {MARKET_LABEL[g.market]}
              </span>
              {g.items.map((idx) => {
                const up = idx.changePct >= 0;
                const tone = up ? "text-up" : "text-down";
                return (
                  <div
                    key={idx.symbol}
                    className="flex shrink-0 items-baseline gap-2"
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
            </div>
          </Fragment>
        ))}
        <span className="ml-auto hidden shrink-0 pl-4 text-[11px] text-muted sm:block">
          行情仅供参考
        </span>
      </div>
      {/* 右侧渐隐：仅在真的溢出时出现，提示可横滑（右边还有港股/美股），并把裁切处收干净 */}
      {overflowing ? (
        <div className="pointer-events-none absolute inset-y-px right-px w-10 rounded-r-xl bg-gradient-to-l from-surface to-transparent" />
      ) : null}
    </div>
  );
}
