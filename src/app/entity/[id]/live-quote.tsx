"use client";

import { useEffect, useRef, useState } from "react";

import { isAShareTradingTime } from "~/lib/market-hours";
import { api, type RouterOutputs } from "~/trpc/react";

type Quote = NonNullable<RouterOutputs["quote"]["get"]>;

/** 轮询间隔。15 秒：够「实时」，一只股一个交易日约 960 次，新浪接口量级无压力。 */
const POLL_MS = 15_000;

/**
 * 行情数字的**实时部分**——价格 / 涨跌额 / 涨跌幅 / 昨收今开高低六格。
 *
 * 为什么单独拆一个客户端组件：`QuoteCard` 是服务端组件，靠 `<Suspense>` 流式送达一次就定住了，
 * 用户停在个股页上数字永远不动，必须手动刷新（2026-08-04 张楚寒反馈）。而首页指数条
 * `_components/market-strip.tsx` 早就有 60 秒轮询——同一个产品里两种行为。
 *
 * 只把这六个数字客户端化，K 线与估值卡仍留在服务端：它们是日频数据，跟着刷纯属浪费。
 *
 * 服务端那次抓到的值经 `initial` 传进来当 `initialData`，所以**首屏没有 loading、没有闪**，
 * 也不会因为多一次挂载请求而拖慢首屏（`staleTime` 覆盖一个轮询周期）。
 */
export function LiveQuote({
  ticker,
  initial,
  children,
}: {
  ticker: string;
  initial: Quote;
  /** 走势图（服务端渲染的日 K）。夹在价格与四格之间，保持原版式顺序。 */
  children?: React.ReactNode;
}) {
  const { data, dataUpdatedAt } = api.quote.get.useQuery(
    { ticker },
    {
      initialData: initial,
      staleTime: POLL_MS,
      // 只在开市时轮询：收盘后每 15 秒去打新浪拿回同一个收盘价，白烧用户流量和第三方配额。
      // 返回 false = 停轮询；用户切走标签页时 React Query 默认也会暂停
      // （`refetchIntervalInBackground` 默认 false），切回来自动补一次。
      refetchInterval: () => (isAShareTradingTime(new Date()) ? POLL_MS : false),
    },
  );

  // 抓失败时 `fetchQuote` 返回 null（不抛），于是 data 会变成 null——
  // 此时保留上一次拿到的好数据，别把界面清空或跳回首屏那个更旧的值。
  const lastGood = useRef<Quote>(initial);
  if (data) lastGood.current = data;
  const quote = data ?? lastGood.current;

  const pct = quote.changePct;
  // 0.00%（平盘/停牌）不染红不染绿——`>= 0` 会把 0 染成红（同 market-strip 的三态）。
  const color = pct > 0 ? "text-up" : pct < 0 ? "text-down" : "text-muted";
  const flash = useFlashOnChange(quote.price);

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`tabular rounded px-1 text-3xl font-bold transition-colors duration-500 ${color} ${
            flash === "up"
              ? "bg-up/15"
              : flash === "down"
                ? "bg-down/15"
                : "bg-transparent"
          }`}
        >
          {quote.price.toFixed(2)}
        </span>
        <span className={`tabular text-sm font-medium ${color}`}>
          {pct > 0 ? "+" : ""}
          {(quote.price - quote.prevClose).toFixed(2)}　{pct > 0 ? "+" : ""}
          {quote.changePct.toFixed(2)}%
        </span>
        <UpdatedAt at={dataUpdatedAt} />
      </div>
      {children}
      <dl className="mt-3 grid grid-cols-4 gap-2 text-xs lg:grid-cols-2 lg:gap-3">
        <QuoteStat label="昨收" value={quote.prevClose} />
        <QuoteStat label="今开" value={quote.open} />
        <QuoteStat label="最高" value={quote.high} />
        <QuoteStat label="最低" value={quote.low} />
      </dl>
    </>
  );
}

/**
 * 价格变动时短暂着色，让「它确实在自己跳」这件事看得见。
 * 停牌 / 冷门股可能几分钟不动一下，所以不能只靠闪烁证明活着——时间戳才是那个证据。
 */
function useFlashOnChange(price: number): "up" | "down" | null {
  const prev = useRef(price);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (price === prev.current) return;
    setFlash(price > prev.current ? "up" : "down");
    prev.current = price;
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [price]);

  return flash;
}

/**
 * 「HH:MM:SS 更新」——用户停在页面上时唯一能证明数据在动的东西。
 *
 * 挂载后才渲染：服务端与客户端的时钟必然不同，直接渲染会 hydration mismatch。
 * 时间按**北京时间**格式化，不跟随浏览器本地时区——这是 A 股行情的时间戳。
 */
function UpdatedAt({ at }: { at: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !at) return null;

  return (
    <span className="tabular text-[11px] text-faint">
      {new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(at))}{" "}
      更新
    </span>
  );
}

function QuoteStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular text-ink">{value > 0 ? value.toFixed(2) : "—"}</dd>
    </div>
  );
}
