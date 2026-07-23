"use client";

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
 *
 * 布局：**自动换行、不横向滚动**——十个指数横排会溢出，滚动会把港美藏在视野外
 * （用户不滑就不知道有）。每个市场是一个 flex-wrap 单元：分组标签始终贴着自己的指数，
 * 组内窄屏可再换行，组与组之间自然排布。港美在 A 股时段是上一交易日收盘，靠分组标注区分。
 *
 * 数据失败则整条隐藏。
 */
export function MarketStrip() {
  const { data, isPending } = api.quote.indices.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isPending) {
    return (
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-baseline gap-2">
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
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {groups.map((g) => (
          <div
            key={g.market}
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            <span className="text-[11px] font-medium text-faint">
              {MARKET_LABEL[g.market]}
            </span>
            {g.items.map((idx) => {
              // 按显示精度判定三态。0 必须是中性色：港美盘前新浪会把涨跌幅重置为 0.00、
              // 最新价仍是上一交易日收盘，若沿用「>=0 即涨」会渲染成红色 +0.00%，
              // 读起来像「今天平盘」，实际是「今天还没开盘」——财经产品不能这么误导。
              const pct = Number(idx.changePct.toFixed(2));
              const tone =
                pct > 0 ? "text-up" : pct < 0 ? "text-down" : "text-muted";
              return (
                <div key={idx.symbol} className="flex items-baseline gap-2">
                  <span className="text-xs text-muted">{idx.label}</span>
                  <span className={`tabular text-sm font-semibold ${tone}`}>
                    {idx.price.toFixed(2)}
                  </span>
                  <span className={`tabular text-xs ${tone}`}>
                    {pct > 0 ? "+" : ""}
                    {pct.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        <span className="ml-auto hidden pl-4 text-[11px] text-muted sm:block">
          行情仅供参考
        </span>
      </div>
    </div>
  );
}
