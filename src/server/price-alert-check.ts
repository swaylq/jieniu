// 到价提醒比价（#3b）——cron 每轮跑一次：拉生效提醒的行情，触发即一次性置 active=false + 记触发价/时间。
// 相对导入、tsx 安全（cron 走 tsx，且 ./quote 已改相对导入，链路不含 ~ 别名）。

import type { PrismaClient } from "../../generated/prisma";
import { shouldTriggerAlert, type AlertDirection } from "../lib/price-alert";
import { fetchQuote } from "./quote";

type CheckDb = Pick<PrismaClient, "priceAlert">;

/**
 * 检查所有生效到价提醒：按 ticker 去重拉一次行情，触发者置 active=false + triggeredAt/triggeredPrice。
 * 一次性触发（避免反复打扰）；用户可在提醒中心看到、或重新启用。返回统计。
 */
export async function checkPriceAlerts(
  db: CheckDb,
): Promise<{ checked: number; triggered: number }> {
  const alerts = await db.priceAlert.findMany({
    where: { active: true },
    select: { id: true, ticker: true, direction: true, threshold: true },
  });
  if (alerts.length === 0) return { checked: 0, triggered: 0 };

  const tickers = [...new Set(alerts.map((a) => a.ticker))];
  const quoted = await Promise.all(
    tickers.map(async (t) => [t, (await fetchQuote(t))?.price] as const),
  );
  const priceByTicker = new Map<string, number>();
  for (const [t, p] of quoted) {
    if (typeof p === "number" && p > 0) priceByTicker.set(t, p);
  }

  const now = new Date();
  let triggered = 0;
  for (const a of alerts) {
    const price = priceByTicker.get(a.ticker);
    if (price === undefined) continue;
    if (shouldTriggerAlert(a.direction as AlertDirection, a.threshold, price)) {
      await db.priceAlert.update({
        where: { id: a.id },
        data: { active: false, triggeredAt: now, triggeredPrice: price },
      });
      triggered++;
    }
  }
  return { checked: alerts.length, triggered };
}
