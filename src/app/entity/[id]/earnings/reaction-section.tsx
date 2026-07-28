import { fetchDailyBars } from "~/server/kline";
import { fetchStockAppointments } from "~/server/ingest/disclosure";
import { pastDisclosures } from "~/lib/disclosure";
import { buildReactions } from "~/lib/earnings-reaction";
import { EarningsReactionCard } from "../../../_components/earnings-reaction-card";

/**
 * 历史财报日反应 —— **独立的 async 服务端组件，靠 `<Suspense>` 流式送达**。
 *
 * 它要打两个外部接口（东财预约披露时间表 + 东财/新浪日线），`cache: "no-store"`，
 * 而东财对本节点是**间歇封锁**的。个股页那次的教训是：把外部接口 await 在关键路径上，
 * 整页可用性就绑在会抽风的第三方上。所以这块自己转圈补齐，**不要 inline 回页面**。
 */
export async function EarningsReactionSection({ ticker }: { ticker: string }) {
  const [rows, bars] = await Promise.all([
    fetchStockAppointments(ticker).catch(() => []),
    fetchDailyBars(ticker, 2),
  ]);
  if (bars.length === 0) return null;

  const reactions = buildReactions(pastDisclosures(rows), bars, 6);
  return <EarningsReactionCard reactions={reactions} />;
}

export function ReactionSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <div className="h-5 w-40 animate-pulse rounded bg-line/70" />
      <div className="mt-3 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-4 w-full animate-pulse rounded bg-line/50" />
        ))}
      </div>
    </div>
  );
}
