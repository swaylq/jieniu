"use client";

import { api } from "~/trpc/react";

/**
 * 页头右上角的紧凑行情（2026-08-05，照决策卡概念稿把价格提到标题旁边）。
 *
 * ## 为什么需要它
 *
 * 「个股观察卡」搬到第一屏之后，行情卡被顶到一屏半以下——而解牛是个天天来看的工作台，
 * 把价格埋掉是实打实的倒退。概念稿的解法正好在版式里：名称在左，价格与涨跌在右，同一行。
 *
 * ## 为什么它不自己发请求（`enabled: false`）
 *
 * 它和 `LiveQuote` 共用同一个 tRPC query key（`quote.get {ticker}`），
 * 而 `LiveQuote` 的 `initialData` 来自 `QuoteCard` 那次服务端抓取。
 * 所以这里**只读缓存、不发请求**：行情卡流式补齐的那一刻，页头这份跟着一起有值，
 * 之后 `LiveQuote` 每 15 秒轮询刷新的也是同一份缓存 —— 页头跟着一起跳，零额外网络请求。
 * 若自己 `enabled: true`，会在行情卡之前先打一次新浪，等于把外部请求翻倍。
 *
 * 拿不到值就整块不渲染（非 A 股 / 抓取失败）：宁可没有，也不要一个空的占位框。
 */
export function HeaderQuote({ ticker }: { ticker: string }) {
  const { data } = api.quote.get.useQuery({ ticker }, { enabled: false });
  if (!data) return null;

  const pct = data.changePct;
  // 0.00%（平盘/停牌）不染红不染绿——`>= 0` 会把 0 染成红（同 market-strip 的三态）。
  const color = pct > 0 ? "text-up" : pct < 0 ? "text-down" : "text-muted";
  return (
    <div className="text-right">
      <div className="flex items-baseline justify-end gap-2">
        <span className={`tabular text-2xl leading-none font-bold ${color}`}>
          {data.price.toFixed(2)}
        </span>
        <span className={`tabular text-sm font-medium ${color}`}>
          {pct > 0 ? "+" : ""}
          {pct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
