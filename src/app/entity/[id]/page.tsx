import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { type Metadata } from "next";

import { api } from "~/trpc/server";
import { SITE_DESCRIPTION, abs, openGraph, twitter } from "~/lib/seo";
import { auth } from "~/server/auth";
import { entityTypeLabel, formatMarketCap } from "~/lib/format";
import { hasValuation } from "~/lib/quote";
import { collapseAnnouncementBursts } from "~/lib/announcements";
import { BUCKET_LABEL, type RelationBucket } from "~/lib/entity-graph";
import { fetchQuote, fetchKline, fetchValuation } from "~/server/quote";
import { asStringArray, type ThesisDimension } from "~/lib/thesis";
import { normalizeUserDimensions } from "~/lib/user-thesis";
import { FollowButton } from "./_follow-button";
import { HoldingEditor, type HoldingInitial } from "../../_components/holding-editor";
import { PriceAlertCard } from "../../_components/price-alert-card";
import { DecisionEditor } from "../../_components/decision-editor";
import { DecisionList, type DecisionItem } from "../../_components/decision-list";
import { NewsCard } from "../../_components/news-card";
import { NewsScorecard } from "../../_components/news-scorecard";
import { PriceChart } from "../../_components/price-chart";
import { SectionHead, chipClass } from "../../_components/section-head";
import { ThesisCard } from "../../_components/thesis-card";
import { MyThesisCard } from "../../_components/my-thesis-card";
import { AdoptThesisButton } from "../../_components/adopt-thesis-button";
import { EcosystemCoverage } from "../../_components/ecosystem-coverage";
import { CatalystCalendar } from "../../_components/catalyst-calendar";
import { upcomingDisclosureNodes } from "~/lib/earnings-calendar";
import { EventTimeline } from "../../_components/event-timeline-card";
import { buildEventTimeline } from "~/lib/event-timeline";

export const dynamic = "force-dynamic";

// 同一次请求里 generateMetadata 与页面共用一次查询（React cache 去重，不多打一次 DB）。
const getEntityData = cache((id: string) => api.entity.getById({ id }));

function entityDescription(e: {
  name: string;
  ticker: string | null;
  type: string;
}): string {
  const nt = e.ticker ? `${e.name}（${e.ticker}）` : e.name;
  switch (e.type) {
    case "STOCK":
      return `${nt} 的一手公告、重磅资讯、AI 投资逻辑（thesis）与关联图谱 —— 解牛聚焦式追踪，只盯真正影响逻辑的变化，而非每条新闻。`;
    case "COMPANY":
      return `${e.name} 的最新动态、发行股票、关联图谱与投资逻辑追踪 —— 解牛聚焦式一手财经资讯与私人投研工作台。`;
    case "SECTOR":
      return `${e.name}板块的热门个股、一手资讯与投资逻辑聚焦 —— 解牛只覆盖最热门板块的核心标的。`;
    case "PERSON":
      return `与 ${e.name} 相关的公司、职务与市场动态追踪 —— 解牛聚焦式财经资讯与大师视角解读。`;
    default:
      return SITE_DESCRIPTION;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await getEntityData(id);
  if (!data) return { title: "未找到", robots: { index: false, follow: false } };
  const { entity: e } = data;
  const title =
    e.type === "SECTOR"
      ? `${e.name}板块`
      : e.ticker
        ? `${e.name}（${e.ticker}）`
        : e.name;
  const description = entityDescription(e);
  const url = `/entity/${id}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: openGraph({ url: abs(url), title, description }),
    twitter: twitter({ title, description }),
  };
}

type Tab = "news" | "announce" | "relation";

function QuoteStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular text-ink">{value > 0 ? value.toFixed(2) : "—"}</dd>
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

export default async function EntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab =
    sp.tab === "announce" || sp.tab === "relation" ? sp.tab : "news";

  const [
    data,
    rawNews,
    session,
    followers,
    scorecard,
    thesis,
    thesisSignals,
    ecosystem,
  ] = await Promise.all([
    getEntityData(id),
    api.entity.newsById({ id }),
    auth(),
    api.entity.followerCount({ id }),
    api.entity.scorecard({ id }),
    api.entity.thesis({ id }),
    api.entity.thesisSignals({ id }),
    api.entity.ecosystem({ id }),
  ]);
  if (!data) notFound();
  // 折叠同日一手公告轰炸（定增/重组当天甩十几份程序性文档）——两个 tab 都受益，避免单事件刷屏。
  const news = collapseAnnouncementBursts(rawNews);
  const { entity, groups } = data;
  // 公司页本身没有 ticker，取其发行股票(关系里的 STOCK)的代码，让行情/走势也出现在公司页。
  const relatedTicker = Object.values(groups)
    .flat()
    .find((e) => e.type === "STOCK" && e.ticker)?.ticker;
  const quoteTicker = entity.ticker ?? relatedTicker ?? null;
  const [quote, kline, valuation] = quoteTicker
    ? await Promise.all([
        fetchQuote(quoteTicker),
        fetchKline(quoteTicker, 250),
        fetchValuation(quoteTicker),
      ])
    : [null, [] as number[], null];
  const buckets = (Object.keys(groups) as RelationBucket[]).filter(
    (b) => groups[b].length > 0,
  );
  const announcements = news.filter((n) => n.tier === "PRIMARY");
  const [following, holding, decisions, userThesis] = session?.user
    ? await Promise.all([
        api.watchlist.isFollowing({ entityId: id }),
        api.portfolio.get({ entityId: id }),
        api.decision.listByEntity({ entityId: id }),
        api.userThesis.get({ entityId: id }),
      ])
    : ([false, null, [], null] as [
        boolean,
        HoldingInitial,
        DecisionItem[],
        Awaited<ReturnType<typeof api.userThesis.get>>,
      ]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "news", label: `资讯 ${news.length}` },
    { key: "announce", label: `公告 ${announcements.length}` },
    { key: "relation", label: "关系" },
  ];
  const listItems = tab === "announce" ? announcements : news;
  const emptyMsg = tab === "announce" ? "暂无公告" : "暂无相关资讯";
  const up = quote ? quote.changePct >= 0 : true;
  const quoteColor = up ? "text-up" : "text-down";

  // 关系去重扁平化，供右栏「相关」卡片使用
  const relatedFlat = Array.from(
    new Map(
      buckets.flatMap((b) => groups[b]).map((e) => [e.id, e] as const),
    ).values(),
  );
  const hasRail = quote !== null || relatedFlat.length > 0 || news.length > 0;

  const feed = (
    <>
      <div className="flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/entity/${id}?tab=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-brand font-semibold text-brand"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="mt-4">
        {tab === "relation" ? (
          buckets.length === 0 ? (
            <p className="text-sm text-muted">暂无关系数据</p>
          ) : (
            buckets.map((b) => (
              <section key={b} className="mb-5">
                <h2 className="mb-2 text-sm font-semibold text-ink">
                  {BUCKET_LABEL[b]}
                </h2>
                <ul className="flex flex-wrap gap-2">
                  {groups[b].map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/entity/${e.id}`}
                        className="inline-flex rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-brand hover:text-brand"
                      >
                        {e.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )
        ) : listItems.length === 0 ? (
          <p className="text-sm text-muted">{emptyMsg}</p>
        ) : (
          <ul className="space-y-3">
            {listItems.map((n) => (
              <NewsCard key={n.id} n={n} />
            ))}
          </ul>
        )}
      </div>
    </>
  );

  const quoteCard = quote ? (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-baseline gap-3">
        <span className={`tabular text-3xl font-bold ${quoteColor}`}>
          {quote.price.toFixed(2)}
        </span>
        <span className={`tabular text-sm font-medium ${quoteColor}`}>
          {up ? "+" : ""}
          {(quote.price - quote.prevClose).toFixed(2)}　{up ? "+" : ""}
          {quote.changePct.toFixed(2)}%
        </span>
      </div>
      {kline.length >= 2 ? <PriceChart values={kline} /> : null}
      <dl className="mt-3 grid grid-cols-4 gap-2 text-xs lg:grid-cols-2 lg:gap-3">
        <QuoteStat label="昨收" value={quote.prevClose} />
        <QuoteStat label="今开" value={quote.open} />
        <QuoteStat label="最高" value={quote.high} />
        <QuoteStat label="最低" value={quote.low} />
      </dl>
      {valuation && hasValuation(valuation) ? (
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
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            来源 东方财富 · 客观估值指标，非评级、非投资建议、不代表高估或低估判断
          </p>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted">行情数据仅供参考，非投资建议</p>
    </div>
  ) : null;

  const thesisData = thesis
    ? {
        summary: thesis.summary,
        dimensions: (thesis.dimensions as unknown as ThesisDimension[]) ?? [],
        bullCase: thesis.bullCase,
        bearCase: thesis.bearCase,
        catalysts: asStringArray(thesis.catalysts),
        invalidations: asStringArray(thesis.invalidations),
        keyLevels: thesis.keyLevels,
      }
    : null;
  // 用户已采纳 → 显示「我的投资逻辑」（可编辑、按我的维度/敏感度个性化）；
  // 否则显示共享 base 框架 +（登录时）「设为我的逻辑」入口。
  const myDims = userThesis
    ? normalizeUserDimensions(userThesis.dimensions as unknown as unknown[])
    : [];
  const thesisBlock =
    userThesis && myDims.length > 0 ? (
      <div className="mb-6">
        <MyThesisCard
          entityId={id}
          name={entity.name}
          reason={userThesis.reason}
          dimensions={myDims}
          signals={thesisSignals}
          updatedAt={userThesis.updatedAt}
        />
      </div>
    ) : thesisData ? (
      <div className="mb-6">
        <ThesisCard
          name={entity.name}
          data={thesisData}
          signals={thesisSignals}
          updatedAt={thesis?.updatedAt}
        />
        {session?.user ? <AdoptThesisButton entityId={id} /> : null}
      </div>
    ) : null;
  const ecosystemBlock =
    ecosystem.sectors.length > 0 || ecosystem.peers.length > 0 ? (
      <div className="mt-6">
        <EcosystemCoverage {...ecosystem} />
      </div>
    ) : null;
  // 催化日历（P5-9）：上市公司/股票才有财报披露节点；叠加该股 thesis 催化剂（若有）。
  const catalystBlock =
    entity.type === "COMPANY" || entity.type === "STOCK" ? (
      <div className="mb-6">
        <CatalystCalendar
          nodes={upcomingDisclosureNodes(new Date(), 2)}
          catalysts={thesisData?.catalysts ?? []}
        />
      </div>
    ) : null;
  // 事件时间线复盘（P5-11）：材料级信号 + 你的决策，倒序 + 后续印证判定。
  const timeline = buildEventTimeline(thesisSignals, decisions);
  const timelineBlock =
    timeline.length > 0 ? (
      <div className="mb-6">
        <EventTimeline items={timeline} />
      </div>
    ) : null;

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-7xl lg:px-8">
      <Link
        href="/"
        className="text-sm text-muted transition-colors hover:text-brand"
      >
        ← 首页
      </Link>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-white/10 dark:text-gray-300">
            {entityTypeLabel(entity.type)}
          </span>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink lg:text-3xl">
            {entity.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {entity.ticker ? (
              <span className="tabular">
                {entity.exchange ?? ""} {entity.ticker} ·{" "}
              </span>
            ) : null}
            {followers} 人关注
          </p>
        </div>
        <FollowButton
          entityId={entity.id}
          loggedIn={!!session?.user}
          initialFollowing={following}
        />
      </div>

      {hasRail ? (
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
          <aside className="space-y-4 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:self-start">
            {quoteCard}
            {session?.user ? (
              <HoldingEditor entityId={id} initial={holding} />
            ) : null}
            {session?.user && quoteTicker ? (
              <PriceAlertCard entityId={id} />
            ) : null}
            {session?.user ? (
              <section
                id="decision"
                className="scroll-mt-20 rounded-xl border border-line bg-surface p-4 shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden>📝</span>
                  <h3 className="text-sm font-bold text-ink">决策记录</h3>
                  {decisions.length > 0 ? (
                    <span className="ml-auto text-[11px] text-muted">
                      {decisions.length}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3">
                  <DecisionEditor entityId={id} />
                </div>
                {decisions.length > 0 ? (
                  <div className="mt-3">
                    <DecisionList decisions={decisions} />
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] leading-relaxed text-muted">
                    记下买/卖/加/减的理由，日后逻辑有变时解牛帮你对照当初的判断。
                  </p>
                )}
              </section>
            ) : null}
            {news.length > 0 ? <NewsScorecard data={scorecard} /> : null}
            {relatedFlat.length > 0 && (
              <section className="rounded-xl border border-line bg-surface p-4">
                <SectionHead title="相关" hint={`${relatedFlat.length}`} />
                <ul className="flex flex-wrap gap-2">
                  {relatedFlat.slice(0, 12).map((e) => (
                    <li key={e.id}>
                      <Link href={`/entity/${e.id}`} className={chipClass}>
                        {e.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            {thesisBlock}
            {timelineBlock}
            {catalystBlock}
            {feed}
            {ecosystemBlock}
          </div>
        </div>
      ) : (
        <div className="mt-5">
          {thesisBlock}
          {timelineBlock}
          {catalystBlock}
          {feed}
          {ecosystemBlock}
        </div>
      )}
    </main>
  );
}
