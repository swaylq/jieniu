import Link from "next/link";

import { api } from "~/trpc/server";
import { auth } from "~/server/auth";
import { entityTypeLabel } from "~/lib/format";
import { partitionPortfolio } from "~/lib/portfolio";
import { DecisionList } from "../_components/decision-list";
import { InvestorProfileCard } from "../_components/investor-profile-card";
import { LogoMark } from "../_components/logo";
import { NewsCard } from "../_components/news-card";
import { SectionHead, primaryBtn } from "../_components/section-head";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="mx-auto max-w-2xl p-4 lg:max-w-3xl">
        <div className="mt-8 rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
          <LogoMark className="mx-auto mb-4 h-14 w-14" />
          <p className="text-muted">登录后管理关注、收藏与个性化内容</p>
          <Link href="/login?returnTo=/profile" className={`mt-4 ${primaryBtn}`}>
            邮箱登录
          </Link>
          <Link
            href="/onboarding"
            className="mt-3 block text-sm font-medium text-brand hover:underline"
          >
            个性化订阅感兴趣的板块 →
          </Link>
        </div>
      </main>
    );
  }

  const [portfolio, bookmarks, recent, decisions, investorProfile] =
    await Promise.all([
      api.portfolio.list(),
      api.bookmarks.list(),
      api.analytics.recentViews(),
      api.decision.listMine(),
      api.investorProfile.get(),
    ]);
  const { holdings, watching } = partitionPortfolio(portfolio);

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-3xl">
      <div className="flex items-center gap-3">
        <LogoMark className="h-12 w-12" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">
            {session.user.email}
          </p>
          <p className="text-xs text-muted">解牛用户</p>
        </div>
      </div>

      <div className="mt-8">
        <InvestorProfileCard initial={investorProfile} />
      </div>

      <section className="mt-8">
        <SectionHead title="我的持仓" hint={`${holdings.length}`} />
        {holdings.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted shadow-sm">
            还没有持仓。在个股页点「记为持仓」录入成本 / 仓位，解牛会围绕它监控你的投资逻辑。
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
            {holdings.map(({ entity: e, costBasis, weight, targetWeight }) => (
              <li key={e.id}>
                <Link
                  href={`/entity/${e.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-canvas"
                >
                  <span className="min-w-0 truncate text-ink">{e.name}</span>
                  <span className="tabular shrink-0 text-xs text-muted">
                    {[
                      costBasis != null ? `成本 ${costBasis}` : null,
                      weight != null ? `仓位 ${weight}%` : null,
                      targetWeight != null ? `目标 ${targetWeight}%` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "未填数值"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          成本 / 仓位为你手录，仅供观察与个性化提醒，非投资建议、不计算盈亏。
        </p>
      </section>

      <section className="mt-8">
        <SectionHead
          title="我的观察"
          hint={`${watching.length}`}
          action={
            <Link href="/discover" className="text-brand hover:underline">
              去发现 →
            </Link>
          }
        />
        {watching.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface p-6 text-center shadow-sm">
            <p className="text-sm text-muted">还没有观察标的</p>
            <Link href="/onboarding" className={`mt-3 ${primaryBtn}`}>
              一键关注感兴趣的板块 →
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
            {watching.map(({ entity: e }) => (
              <li key={e.id}>
                <Link
                  href={`/entity/${e.id}`}
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-canvas"
                >
                  <span className="text-ink">{e.name}</span>
                  <span className="text-xs text-muted">
                    {entityTypeLabel(e.type)} ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {decisions.length > 0 ? (
        <section className="mt-8">
          <SectionHead title="最近决策" hint={`${decisions.length}`} />
          <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <DecisionList decisions={decisions} showEntity />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            你记录的决策与理由；解牛据此在逻辑发生变化时提醒你自查，非投资建议。
          </p>
        </section>
      ) : null}

      <section className="mt-8">
        <SectionHead title="我的收藏" hint={`${bookmarks.length}`} />
        {bookmarks.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted shadow-sm">
            还没有收藏。在资讯详情页点「☆ 收藏」保存感兴趣的内容。
          </p>
        ) : (
          <ul className="space-y-3">
            {bookmarks.map((n) => (
              <NewsCard key={n.id} n={n} />
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section className="mt-8">
          <SectionHead title="最近浏览" />
          <ul className="space-y-3">
            {recent.map((n) => (
              <NewsCard key={n.id} n={n} />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <SectionHead title="账号" />
        <Link
          href="/settings"
          className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm transition-colors hover:border-brand/40"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">账号设置</p>
            <p className="mt-0.5 text-xs text-muted">
              登录密码 · 主题 · 色盲模式 · 退出登录
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-brand">
            设置 ›
          </span>
        </Link>
      </section>
    </main>
  );
}
