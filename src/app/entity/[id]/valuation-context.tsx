import { fetchValuationContext } from "~/server/valuation-context";
import { ValuationContextCard } from "../../_components/valuation-context-card";

/**
 * 估值对照 —— **独立的 async 服务端组件，靠 `<Suspense>` 流式送达**。
 *
 * 它要打两次东财、且第二次依赖第一次给出的 BOARD_CODE（串行两波）。挂进行情卡会把
 * 行情/走势一起拖慢，挂进页面主链路更糟——个股页那次 278ms 的教训就是这么来的。
 * 东财对本节点间歇封锁时它返回 null、整块不渲染，别的内容不受影响。
 * **不要把它 inline 回行情卡或页面里。**
 */
export async function ValuationContextSection({ ticker }: { ticker: string }) {
  const ctx = await fetchValuationContext(ticker);
  return <ValuationContextCard ctx={ctx} />;
}

export function ValuationContextSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="h-5 w-24 animate-pulse rounded bg-line/70" />
      <div className="mt-3 h-3 w-32 animate-pulse rounded bg-line/50" />
      <div className="mt-3 h-1.5 w-full animate-pulse rounded-full bg-line/50" />
    </div>
  );
}
