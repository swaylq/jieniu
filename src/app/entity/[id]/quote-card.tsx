import { formatMarketCap } from "~/lib/format";
import { hasValuation } from "~/lib/quote";
import { fetchQuote, fetchKline, fetchValuation } from "~/server/quote";
import { PriceChart } from "../../_components/price-chart";
import { LiveQuote } from "./live-quote";

/**
 * 行情 / 走势 / 估值卡 —— **独立的 async 服务端组件，靠 `<Suspense>` 流式送达**。
 *
 * 为什么要拆出来：这三个 fetch 打的是新浪 / 腾讯 / 东方财富的外部接口，`cache: "no-store"`，
 * 实测各 130–200ms，且超时上限 6s。原来它们跟页面主内容串在同一条 await 链上——个股页服务端
 * 渲染 ~278ms 里有 150–200ms 是在等外部行情，而东财对本机是**间歇封锁**的（见
 * `evolution/lessons.md` 与 quote.ts 的腾讯兜底），一旦卡住整页跟着卡到 6s。
 *
 * 拆开之后：页面骨架 + 资讯 + 投资逻辑先上屏，这张卡自己转圈补齐。外部接口再慢也只慢它自己。
 * **不要把它 inline 回页面里。**
 */
export async function QuoteCard({ ticker }: { ticker: string }) {
  const [quote, kline, valuation] = await Promise.all([
    fetchQuote(ticker),
    fetchKline(ticker, 250),
    fetchValuation(ticker),
  ]);
  if (!quote) return null;

  const showVal = valuation && hasValuation(valuation);

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      {/* 价格与四格行情走客户端组件自行轮询——服务端渲染的这一份只作首帧初值。
          K 线与估值仍留服务端：日频数据，跟着刷没有意义。走势图作 children 传进去，
          是为了保持原来的版式顺序（价格 → 走势 → 四格），且它本身不进客户端 bundle。 */}
      <LiveQuote ticker={ticker} initial={quote}>
        {kline.length >= 2 ? <PriceChart values={kline} /> : null}
      </LiveQuote>
      {showVal ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-xs font-medium text-muted">
            估值 · 客观数据，非评级
          </p>
          <dl className="grid grid-cols-4 gap-2 text-xs lg:grid-cols-2 lg:gap-3">
            {valuation.pe !== null ? (
              <ValuationStat label="市盈率(动)" value={valuation.pe.toFixed(2)} />
            ) : null}
            {valuation.pb !== null ? (
              <ValuationStat label="市净率" value={valuation.pb.toFixed(2)} />
            ) : null}
            {valuation.marketCap !== null ? (
              <ValuationStat
                label="总市值"
                value={formatMarketCap(valuation.marketCap)}
              />
            ) : null}
            {valuation.turnover !== null ? (
              <ValuationStat
                label="换手率"
                value={`${valuation.turnover.toFixed(2)}%`}
              />
            ) : null}
          </dl>
        </div>
      ) : null}
      {/* 免责合并成一条：原本估值段尾与卡片底部各一条、都以「非投资建议」结尾，紧挨着重复。
          合并后顺带补上行情来源（原先只标了估值来源，行情没标）。 */}
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        行情来自新浪 / 腾讯
        {showVal ? "、估值来自东方财富" : ""} · 仅供参考，
        {showVal ? "非评级、" : ""}非投资建议
        {showVal ? "、不代表高估或低估判断" : ""}
      </p>
    </div>
  );
}

/** 流式等待时的占位：高度贴近真卡（价格 + 走势 + 四格），避免补齐时页面跳一下。 */
export function QuoteCardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="h-9 w-32 animate-pulse rounded bg-muted/20" />
      <div className="mt-3 h-16 w-full animate-pulse rounded bg-muted/15" />
      <div className="mt-3 grid grid-cols-4 gap-2 lg:grid-cols-2 lg:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-muted/15" />
        ))}
      </div>
    </div>
  );
}

// 估值指标格（客观值，中性色——铁律①红绿只给股价）。
function ValuationStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular font-medium text-ink">{value}</dd>
    </div>
  );
}
