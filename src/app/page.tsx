import Link from "next/link";

import { api } from "~/trpc/server";
import { auth } from "~/server/auth";
import { upcomingDisclosureNodes } from "~/lib/earnings-calendar";
import {
  greetingByHour,
  briefingStats,
  briefingHeadline,
  briefingSubline,
} from "~/lib/briefing";
import type { ThesisDimension } from "~/lib/thesis";
import { EntitySearch } from "./_components/entity-search";
import { MarketStrip } from "./_components/market-strip";
import { PortfolioChanged } from "./_components/portfolio-changed";
import { PortfolioImpact } from "./_components/portfolio-impact";
import { DailyDigest } from "./_components/daily-digest";
import { CatalystCalendar } from "./_components/catalyst-calendar";
import { MorningBriefing } from "./_components/morning-briefing";
import { WorkbenchRail, type CurrentCard } from "./_components/workbench-rail";
import { HotSectorGrid } from "./_components/hot-sector-grid";
import { displayCls, primaryBtn } from "./_components/section-head";

export const dynamic = "force-dynamic";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 核心持仓的「当前投资卡」：优先取有实质变化的持仓、其次首个持仓；找到有 thesis 的即算逻辑验证进度。无行情数值。 */
async function buildCurrentCard(
  rankedIds: string[],
  nameById: Map<string, string>,
): Promise<CurrentCard | null> {
  const uniq = [...new Set(rankedIds)].filter((id) => nameById.has(id));
  if (uniq.length === 0) return null;
  for (const id of uniq.slice(0, 4)) {
    const thesis = await api.entity.thesis({ id });
    if (!thesis) continue;
    const dims = (thesis.dimensions as unknown as ThesisDimension[]) ?? [];
    const signals = await api.entity.thesisSignals({ id });
    const hitKeys = new Set(signals.map((s) => s.dimensionKey));
    const hitDims = dims.filter((d) => hitKeys.has(d.key)).length;
    const progress = dims.length > 0 ? Math.round((hitDims / dims.length) * 100) : 0;
    return {
      entityId: id,
      name: nameById.get(id)!,
      summary: thesis.summary,
      progress,
      dims: dims.length,
      hitDims,
    };
  }
  // 无 thesis：仍给出首个持仓卡（引导生成逻辑）。
  const first = uniq[0]!;
  return {
    entityId: first,
    name: nameById.get(first)!,
    summary: null,
    progress: 0,
    dims: 0,
    hitDims: 0,
  };
}

export default async function Home() {
  const session = await auth();
  const loggedIn = !!session?.user;
  const now = new Date();
  const dateLabel = `${now.getFullYear()}.${pad2(now.getMonth() + 1)}.${pad2(now.getDate())}`;
  const greeting = greetingByHour(now.getHours());
  const upcoming = upcomingDisclosureNodes(now, 2);

  // ---------- 登出态：私人投研工作台「介绍页」——重点覆盖热门板块，不是全市场资讯流 ----------
  if (!loggedIn) {
    const [hot, marketDigest] = await Promise.all([
      api.entity.hotSectors(),
      api.news.digest(),
    ]);
    return (
      <main className="mx-auto w-full max-w-6xl p-4 lg:px-8 lg:py-6">
        <MarketStrip />

        <section className="mt-6 rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[1.5px] text-brand">
            你的私人投研 Agent
          </p>
          <h1 className={`mt-2 max-w-3xl text-2xl leading-snug sm:text-[32px] ${displayCls}`}>
            不铺满全市场，只把你在乎的投资逻辑盯牢。
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            解牛聚焦最热门板块里最火的股票，替你从每天的海量资讯里筛出真正触及投资逻辑的那几条——登录后，这里会变成你的每日投资晨报：今天你的组合逻辑变了什么，需要复核什么。
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/login" className={primaryBtn}>
              邮箱登录，开启工作台 →
            </Link>
            <div className="w-full sm:max-w-sm">
              <EntitySearch />
            </div>
          </div>
        </section>

        <div className="mt-8">
          <HotSectorGrid sectors={hot.sectors} totalStocks={hot.totalStocks} />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <DailyDigest market={marketDigest} />
          </div>
          <aside className="space-y-6">
            <CatalystCalendar nodes={upcoming} />
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-base font-bold text-ink">关于解牛</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                聚焦 A股 一手财经资讯 + 投资大师视角解读。一手来源：交易所公告（东方财富·公告，全市场实时含正文）；媒体来源：华尔街见闻、东方财富·快讯、集微网。
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                AI 解读为思维演示，非投资建议；行情数据仅供参考、不预测。
              </p>
            </section>
          </aside>
        </div>
      </main>
    );
  }

  // ---------- 登录态：个人投研工作台（投资晨报） ----------
  const [portfolioList, changed, portfolioImpact, personalDigest, marketDigest] =
    await Promise.all([
      api.portfolio.list(),
      api.portfolio.changed(),
      api.portfolio.impact(),
      api.news.personalDigest(),
      api.news.digest(),
    ]);

  const watched = portfolioList.map((p) => p.entity);
  const nameById = new Map(watched.map((e) => [e.id, e.name]));
  const stats = briefingStats(changed);
  const relatedCount = changed.reduce((n, c) => n + c.materialCount, 0);
  const headline = briefingHeadline(stats.noticeable);
  const subline = briefingSubline(watched.length, relatedCount);
  const name = session.user?.name?.trim() ? session.user.name.trim() : null;

  // 当前投资卡候选：有实质变化的持仓（材料多者优先）→ 其余持仓 → 全部自选。
  const rankedIds = [
    ...changed
      .filter((c) => c.direction !== "unchanged")
      .sort((a, b) => b.materialCount - a.materialCount)
      .map((c) => c.entityId),
    ...portfolioList.filter((p) => p.status === "HOLDING").map((p) => p.entity.id),
    ...watched.map((e) => e.id),
  ];
  const current = await buildCurrentCard(rankedIds, nameById);

  return (
    <main className="mx-auto w-full max-w-7xl p-4 lg:px-8 lg:py-6">
      <MarketStrip />

      <div className="mt-6">
        <MorningBriefing
          greeting={greeting}
          name={name}
          dateLabel={dateLabel}
          headline={headline}
          subline={subline}
          stats={stats}
          upcomingCount={upcoming.length}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <PortfolioChanged items={changed} />
          <PortfolioImpact items={portfolioImpact} />
          <DailyDigest personal={personalDigest} market={marketDigest} />
          <div className="flex justify-end">
            <Link
              href="/review"
              className="text-sm font-medium text-brand transition-colors hover:text-brand-dark"
            >
              过去 30 天回顾 →
            </Link>
          </div>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-4 lg:self-start">
          <WorkbenchRail current={current} changes={changed} />
          <CatalystCalendar nodes={upcoming} />
        </aside>
      </div>
    </main>
  );
}
