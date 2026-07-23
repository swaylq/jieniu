import Link from "next/link";

import { api } from "~/trpc/server";
import { auth } from "~/server/auth";
import { notificationUnread, streamStamp } from "~/lib/format";
import { triggeredMessage, type AlertDirection } from "~/lib/price-alert";
import { NewsCard } from "../_components/news-card";
import { ThesisAlerts } from "../_components/thesis-alerts";
import { AlertProtocol } from "../_components/alert-protocol";
import { displayCls, primaryBtn } from "../_components/section-head";

export const dynamic = "force-dynamic";

function Masthead({ subtitle }: { subtitle?: string }) {
  return (
    <header className="pt-1 pb-4">
      <div className="flex items-center gap-2.5">
        <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
        <h1 className={`text-2xl ${displayCls}`}>提醒中心</h1>
      </div>
      {subtitle ? <p className="mt-2 text-sm text-muted">{subtitle}</p> : null}
    </header>
  );
}

export default async function NotificationsPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="mx-auto max-w-2xl p-4 lg:max-w-4xl">
        <Masthead />
        <div className="mt-2 rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-muted">登录后接收关注实体的重大动态提醒</p>
          <Link href="/login" className={`mt-4 ${primaryBtn}`}>
            邮箱登录
          </Link>
        </div>
      </main>
    );
  }

  // seenBoundary 必须在 markSeen 之前读取，才能算出「本次访问的新动态」。
  const [items, alerts, priceAlerts, seenAt, prefs] = await Promise.all([
    api.notifications.list(),
    api.notifications.thesisAlerts(),
    api.notifications.triggeredPriceAlerts(),
    api.notifications.seenBoundary(),
    api.notifications.alertPrefs(),
  ]);
  await Promise.all([
    api.notifications.markSeen(),
    api.analytics.track({ type: "view_notifications" }),
  ]);

  // 按提醒协议过滤：逻辑变化 → 逻辑异动；重磅资讯 → 重磅新闻；价格 → 到价提醒（query 已按 prefs.price 过滤）。
  const showLogic = prefs.logic;
  const showFund = prefs.fundamental;
  const shownAlerts = showLogic ? alerts : [];
  const shownItems = showFund ? items : [];
  const shownPriceAlerts = priceAlerts;

  const unreadCount =
    shownItems.filter((n) => notificationUnread(n.createdAt, seenAt)).length +
    shownAlerts.filter((a) => notificationUnread(a.createdAt, seenAt)).length +
    shownPriceAlerts.filter(
      (a) => a.triggeredAt && notificationUnread(a.triggeredAt, seenAt),
    ).length;

  const subtitle =
    unreadCount > 0
      ? `你自选股的逻辑异动、重磅资讯与到价提醒 · ${unreadCount} 条新`
      : "你自选股的逻辑异动、重磅资讯与到价提醒";

  const allOff = !showLogic && !showFund && !prefs.price;
  const empty =
    shownItems.length === 0 &&
    shownAlerts.length === 0 &&
    shownPriceAlerts.length === 0;

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-4xl">
      <Masthead subtitle={subtitle} />
      <AlertProtocol initial={prefs} />
      {allOff ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-sm text-muted">
            你已关闭全部提醒分类。打开上方任一「提醒协议」开关，触及逻辑的变化会出现在这里。
          </p>
        </div>
      ) : empty ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-sm text-muted">
            暂无提醒。关注股票并生成投资逻辑后，触及逻辑的材料变化会第一时间出现在这里。
          </p>
          <Link href="/onboarding" className={`mt-3 ${primaryBtn}`}>
            一键关注感兴趣的板块 →
          </Link>
        </div>
      ) : (
        <>
          {shownPriceAlerts.length > 0 ? (
            <section className="mb-4">
              <h2 className="mb-2 text-base font-bold text-ink">到价提醒</h2>
              <ul className="space-y-2">
                {shownPriceAlerts.map((a) => {
                  const unread =
                    !!a.triggeredAt && notificationUnread(a.triggeredAt, seenAt);
                  return (
                    <li key={a.id}>
                      <Link
                        href={`/entity/${a.entity.id}`}
                        className={`block rounded-xl border bg-surface p-3 shadow-sm transition-colors hover:border-brand ${
                          unread ? "border-brand/40 ring-1 ring-brand/40" : "border-line"
                        }`}
                      >
                        <p className="text-sm text-ink">
                          {triggeredMessage(
                            a.entity.name,
                            a.direction as AlertDirection,
                            a.threshold,
                            a.triggeredPrice ?? 0,
                          )}
                        </p>
                        <p className="mt-1 text-[11px] text-muted">
                          {a.triggeredAt ? streamStamp(a.triggeredAt) : ""} ·
                          你设的观察位，非荐买卖
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <ThesisAlerts alerts={shownAlerts} seenAt={seenAt} />
          {shownItems.length > 0 ? (
            <section>
              <h2 className="mb-2 text-base font-bold text-ink">重磅资讯</h2>
              {/* NewsCard 根元素就是 <li>，必须直接放进 <ul>：多包一层 <li>/<div> 会触发
                  非法嵌套，浏览器把卡片重新挂到上层容器，导致卡片逃出内容列撑满整宽。 */}
              <ul className="space-y-3">
                {shownItems.map((n) => (
                  <NewsCard
                    key={n.id}
                    n={n}
                    unread={notificationUnread(n.createdAt, seenAt)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
