import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { type Metadata } from "next";

import { api } from "~/trpc/server";
import { SITE_DESCRIPTION, abs, openGraph, twitter } from "~/lib/seo";
import { auth } from "~/server/auth";
import { entityTypeLabel } from "~/lib/format";
import { collapseAnnouncementBursts } from "~/lib/announcements";
import { groupByMonth, isExpanded, spanSummary } from "~/lib/milestones";
import { resolveQuoteTicker, type RelationBucket } from "~/lib/entity-graph";
import { nameWithCode } from "~/lib/watch-label";
import { ecosystemPeers } from "~/lib/relation-view";
import { EntityTabs } from "../../_components/entity-tabs";
import { asStringArray, type ThesisDimension } from "~/lib/thesis";
import { normalizeUserDimensions } from "~/lib/user-thesis";
import { FollowButton } from "./_follow-button";
import { QuoteCard, QuoteCardSkeleton } from "./quote-card";
import {
  ValuationContextSection,
  ValuationContextSkeleton,
} from "./valuation-context";
import {
  HoldingEditor,
  type HoldingInitial,
} from "../../_components/holding-editor";
import { PriceAlertCard } from "../../_components/price-alert-card";
import { DecisionEditor } from "../../_components/decision-editor";
import {
  DecisionList,
  type DecisionItem,
} from "../../_components/decision-list";
import { NewsCard } from "../../_components/news-card";
import { Pager } from "../../_components/pager";
import { NewsScorecard } from "../../_components/news-scorecard";
import { SignalStrip } from "../../_components/signal-strip";
import { ConsensusCard } from "../../_components/consensus-card";
import { parseConsensusDetail } from "~/lib/consensus";
import { reportsTabHref } from "~/lib/research-reports";
import { parseAppointmentView } from "~/lib/disclosure";
import {
  SectionHead,
  chipClass,
  displayCls,
} from "../../_components/section-head";
import { ThesisCard } from "../../_components/thesis-card";
import { MyThesisCard } from "../../_components/my-thesis-card";
import { AdoptThesisButton } from "../../_components/adopt-thesis-button";
import { ThesisPending } from "../../_components/thesis-pending";
import { EcosystemCoverage } from "../../_components/ecosystem-coverage";
import { CatalystCalendar } from "../../_components/catalyst-calendar";
import { upcomingDisclosureNodes } from "~/lib/earnings-calendar";
import { isAShareTicker } from "~/lib/quote";
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
      return `${nt} 的一手公告、重磅资讯、AI 投资逻辑与关联图谱。解牛只盯真正影响逻辑的变化，不是每条新闻都推。`;
    case "COMPANY":
      return `${e.name} 的最新动态、发行股票、关联图谱与 AI 投资逻辑追踪。`;
    case "SECTOR":
      return `${e.name}板块的成分个股、一手资讯与投资逻辑追踪，A股按行业全覆盖。`;
    case "PERSON":
      return `与 ${e.name} 相关的公司、职务与市场动态追踪。`;
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
  // 找不到时返回 noindex，**不要**在这里 notFound()。
  // Next 15.5 对 force-dynamic 路由的行为：notFound() 会被 not-found 边界在流内正常渲染，
  // 不会冒泡到 app-render 那个设 res.statusCode=404 的 catch（见 app-render.js:1402），
  // 所以状态码留在 200（soft 404）。实测在 generateMetadata 里抛也一样是 200。
  // 状态码改不动，就退而求其次堵住真正的危害：noindex 让爬虫不收录不存在的实体页。
  // 页面组件里的 notFound() 保留——它负责渲染友好的「页面不存在」。
  if (!data)
    return { title: "未找到", robots: { index: false, follow: false } };
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

type Tab = "news" | "announce" | "report" | "milestone" | "relation";

/* QuoteStat / ValuationStat 已随行情卡搬到 ./quote-card.tsx（只有那张卡在用）。 */

export default async function EntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab =
    sp.tab === "announce" ||
    sp.tab === "report" ||
    sp.tab === "relation" ||
    sp.tab === "milestone"
      ? sp.tab
      : "news";
  const pageNum = Math.max(1, Number(sp.page) || 1);
  const listTab =
    tab === "announce" ? "announce" : tab === "report" ? "report" : "news";

  /**
   * 取数刻意压成「一次 `auth()` + 一个 `Promise.all`」。
   *
   * 原来是**四道串行的波**：①9 个 DB 查询 → ②三个外部行情 fetch（要等 ① 拿到 ticker）
   * → ③单独 `await entity.signals` → ④四个用户态查询（要等 ① 的 session）。四段首尾相接，
   * 服务端渲染中位数 278ms（其余页面 17–20ms）。
   *
   * 现在：`auth()` 提到最前（jwt 策略下只是解 cookie，不碰库，~0ms），于是 ③ ④ 都能并到同一个
   * `Promise.all` 里；② 整块搬进 `<QuoteCard>` 走 Suspense 流式，彻底离开关键路径。
   * **加新查询请加进这个 Promise.all，不要在下面再写 `await`**——每多一道串行波就多一次全额延迟。
   */
  const session = await auth();
  const [
    data,
    newsPage,
    milestoneData,
    scorecard,
    thesis,
    thesisSignals,
    ecosystem,
    entitySignals,
    following,
    holding,
    decisions,
    userThesis,
  ] = await Promise.all([
    getEntityData(id),
    api.entity.newsPage({ id, tab: listTab, page: pageNum }),
    api.entity.milestones({ id, months: 12 }),
    api.entity.scorecard({ id }),
    api.entity.thesis({ id }),
    api.entity.thesisSignals({ id }),
    api.entity.ecosystem({ id }),
    // 配对版：Thesis 挂 COMPANY、EntitySignal 挂 STOCK，只查单边会让公司页一条信号都没有。
    api.earnings.signals({ id }),
    session?.user ? api.watchlist.isFollowing({ entityId: id }) : false,
    session?.user
      ? api.portfolio.get({ entityId: id })
      : (null as HoldingInitial),
    session?.user
      ? api.decision.listByEntity({ entityId: id })
      : ([] as DecisionItem[]),
    session?.user
      ? api.userThesis.get({ entityId: id })
      : (null as Awaited<ReturnType<typeof api.userThesis.get>>),
  ]);
  if (!data) notFound();
  // 折叠同日一手公告轰炸（定增/重组当天甩十几份程序性文档）——两个 tab 都受益，避免单事件刷屏。
  // 折叠只作用于**当前这一页**：全量条数以库里的 total 为准，见下方分页条。
  // 「研报」tab 例外：同日多家券商发同一主题正是要看的东西（财报后一天十几篇点评），
  // 折叠会把它当轰炸只留一条，反而把清单打残。
  const news =
    tab === "report"
      ? newsPage.items.map((n) => ({ ...n, burstCount: 0 }))
      : collapseAnnouncementBursts(newsPage.items);
  const { entity, groups } = data;
  // 行情 ticker：STOCK 用自己的、COMPANY 用其发行股票(stocks 桶)；SECTOR/PERSON 无行情
  // （见 resolveQuoteTicker——不再从全部关系桶抓，否则 SECTOR 会把成分股行情当板块行情，run 61 修）。
  const quoteTicker = resolveQuoteTicker(entity, groups);
  // A股专属 UI（实时行情/估值/K线卡、到价提醒、A股法定披露日历）只对 A股 ticker 显示。
  // 美股（NVDA 等，行情/披露规则完全不同）若照挂：行情卡永远返回 null 只剩骨架、到价提醒永不触发、
  // 催化日历显示与其无关的 A股财报截止日——都是不体面的边缘态（QA loop run 8 维度 h）。
  const quotable = isAShareTicker(quoteTicker);
  /**
   * 页头与各卡片标题统一带上代码（张楚寒：「现在有的公司有代码有的没有，不然都加上代码吧」）。
   * 代码在数据模型里是**烙在 STOCK 名字里的字符串**而不是 COMPANY 的字段——5498 家 COMPANY
   * 的 ticker 全为 null。`quoteTicker` 已经替我们把配对股票的代码取出来了，这里复用它。
   */
  const displayName = nameWithCode(entity.name, entity.ticker, quoteTicker);
  /** 交易所前缀同理：COMPANY 自己没有，借配对股票那份。 */
  const displayExchange =
    entity.exchange ?? groups.stocks.find((e) => e.ticker)?.exchange ?? null;
  const buckets = (Object.keys(groups) as RelationBucket[]).filter(
    (b) => groups[b].length > 0,
  );
  // 「公告」tab 现在由服务端按 tier 直接分页取（不再是在资讯里筛），这里只是当前页的条目。
  const announcements = news;

  // 一年大事记：只收重磅事件，按月倒序分组（回填一年后「资讯」流只够看最近几个月）。
  // items 最多 200 条（展示上限），total 是库里真实总数——tab 计数用 total，不把截断值当全量。
  const milestoneItems = milestoneData.items;
  const milestoneTotal = milestoneData.total;
  const milestoneMonths = groupByMonth(milestoneItems);
  // 「关系」tab 原来只铺 `getById` 的原始边——公司那份往往只有一条「发行了某某股票」，
  // 点进去几乎是空的（sway：关系里没有数字也什么内容都没有）。真正有用的「所属行业 + 同行竞品」
  // 一直只画在右栏，tab 里看不到。这里把 ecosystem 并进来，并按去重后的关联对象数给 tab 计数。
  const relationPeers = ecosystemPeers(groups, ecosystem);
  const tabs: { key: Tab; label: string }[] = [
    { key: "news", label: `资讯 ${newsPage.newsTotal}` },
    { key: "announce", label: `公告 ${newsPage.announceTotal}` },
    // 研报 tab 只在有料时出现——库里 6.9k 篇集中在覆盖过的热门股，冷门股给个空 tab 是噪音。
    ...(newsPage.reportTotal > 0
      ? [{ key: "report" as Tab, label: `研报 ${newsPage.reportTotal}` }]
      : []),
    ...(milestoneItems.length > 0
      ? [{ key: "milestone" as Tab, label: `大事记 ${milestoneTotal}` }]
      : []),
    {
      key: "relation",
      label: `关系 ${relationPeers.total}`,
    },
  ];
  const listItems = tab === "announce" ? announcements : news;
  const emptyMsg =
    tab === "announce"
      ? "暂无公告"
      : tab === "report"
        ? "暂无收录的机构研报"
        : "暂无相关资讯";

  // 关系去重扁平化，供右栏「相关」卡片使用
  const relatedFlat = Array.from(
    new Map(
      buckets.flatMap((b) => groups[b]).map((e) => [e.id, e] as const),
    ).values(),
  );
  // 行情卡改成流式后，外壳渲染时还不知道 quote 拿不拿得到——所以右栏是否存在改判「有没有
  // ticker」（有 ticker 就一定会渲染这张卡，最坏情况是卡内返回 null）。
  const hasRail = quotable || relatedFlat.length > 0 || news.length > 0;

  const feed = (
    <>
      {/* tab 条抽成客户端组件：悬停预取（切 tab 慢在网络往返）+ 加载中就地转圈（点击立刻有回应）+
          `scroll={false}`（不把人弹回页首）。三件事都在 `entity-tabs.tsx` 里，见那里的注释。 */}
      <EntityTabs basePath={`/entity/${id}`} tabs={tabs} active={tab} />

      <div className="mt-4">
        {tab === "relation" ? (
          relationPeers.total === 0 ? (
            <p className="text-muted text-sm">暂无关系数据</p>
          ) : (
            relationPeers.sections.map((s) => (
              <section key={s.key} className="mb-5">
                <h2 className="text-ink mb-2 text-sm font-semibold">
                  {s.label}
                </h2>
                <ul className="flex flex-wrap gap-2">
                  {s.items.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/entity/${e.id}`}
                        className="border-line bg-surface text-muted hover:border-brand hover:text-brand inline-flex rounded-full border px-3 py-1.5 text-sm transition-colors"
                      >
                        {e.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )
        ) : tab === "milestone" ? (
          <div>
            <p className="text-muted mb-3 text-xs">
              过去一年的重磅事件，按月折叠 ·{" "}
              {spanSummary(milestoneMonths, milestoneTotal)}
              　例行治理类公告不计入，完整清单见「公告」
            </p>
            {milestoneMonths.map((m, i) => (
              <details
                key={m.key}
                open={isExpanded(i)}
                className="border-line bg-surface mb-2 rounded-xl border"
              >
                <summary className="text-ink flex cursor-pointer list-none items-baseline justify-between px-4 py-2.5 text-sm font-semibold">
                  <span>{m.label}</span>
                  <span className="tabular text-muted text-xs font-normal">
                    {m.items.length} 条
                  </span>
                </summary>
                <ul className="border-line space-y-3 border-t p-3">
                  {m.items.map((n) => (
                    <NewsCard key={n.id} n={n} />
                  ))}
                </ul>
              </details>
            ))}
          </div>
        ) : listItems.length === 0 ? (
          <p className="text-muted text-sm">{emptyMsg}</p>
        ) : (
          <>
            {tab === "report" ? (
              <p className="text-muted mb-3 text-xs leading-relaxed">
                券商研报在这里是
                <span className="text-ink font-medium">事件</span>
                ：只记录「哪家机构在哪天发了一篇什么主题的研报」，不含它的评级与目标价，
                也不代表解牛观点。
              </p>
            ) : null}
            <ul className="space-y-3">
              {listItems.map((n) => (
                <NewsCard key={n.id} n={n} />
              ))}
            </ul>
            <Pager
              basePath={`/entity/${id}`}
              params={{ tab }}
              page={newsPage.page}
              pages={newsPage.pages}
              total={
                tab === "announce"
                  ? newsPage.announceTotal
                  : tab === "report"
                    ? newsPage.reportTotal
                    : newsPage.newsTotal
              }
            />
          </>
        )}
      </div>
    </>
  );

  // 行情卡：Suspense 流式（三个外部行情接口 130–200ms 起、超时上限 6s，不许挡主内容）。
  // 实现见同目录 quote-card.tsx，别 inline 回来。
  const quoteCard = quotable ? (
    <Suspense fallback={<QuoteCardSkeleton />}>
      <QuoteCard ticker={quoteTicker!} />
    </Suspense>
  ) : null;

  // 估值对照（分位 + 同行中位）：又是两波串行的东财请求，单独 Suspense，别并进行情卡。
  const valuationCard = quotable ? (
    <Suspense fallback={<ValuationContextSkeleton />}>
      <ValuationContextSection ticker={quoteTicker!} />
    </Suspense>
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
          name={displayName}
          reason={userThesis.reason}
          dimensions={myDims}
          signals={thesisSignals.items}
          droppedSignals={thesisSignals.dropped}
          updatedAt={userThesis.updatedAt}
        />
      </div>
    ) : thesisData ? (
      <div className="mb-6">
        <ThesisCard
          name={displayName}
          data={thesisData}
          signals={thesisSignals.items}
          droppedSignals={thesisSignals.dropped}
          updatedAt={thesis?.updatedAt}
        />
        {session?.user ? <AdoptThesisButton entityId={id} /> : null}
      </div>
    ) : entity.type === "COMPANY" || entity.type === "STOCK" ? (
      // 没有 thesis 时**不能不渲染**——那样「有的页有、有的页没有」，用户会以为这只股不支持。
      // 改成占位卡 + 客户端触发按需生成（服务端直接生成会把 SSR 拖 ~16s）。
      <ThesisPending entityId={id} name={displayName} />
    ) : null;
  const ecosystemBlock =
    ecosystem.sectors.length > 0 || ecosystem.peers.length > 0 ? (
      <div className="mt-6">
        <EcosystemCoverage {...ecosystem} />
      </div>
    ) : null;
  // 催化日历（P5-9）：上市公司/股票才有财报披露节点；叠加该股 thesis 催化剂（若有）。
  // 催化日历：A股披露节点仅对 A股显示；美股无 A股披露节点，只在它有 thesis 催化剂时才出这张卡，
  // 否则整块不渲染（避免只剩一个空的 mb-6 占位 div 在美股页留一道空隙）。
  // 一致预期从信号条里拆出来单独成卡（分歧度比例条 + EPS 预期）——数据早在库里，
  // 此前只渲染了一行 label。拆分在页面层做，SignalStrip 本身不改。
  const consensusRaw = entitySignals.find((s) => s.kind === "consensus");
  const consensusParsed = consensusRaw
    ? parseConsensusDetail(consensusRaw.detail)
    : null;
  const consensusDetail = consensusParsed
    ? { detail: consensusParsed, asOf: consensusRaw!.asOf }
    : null;
  // 预约披露日（交易所时间表）：有就交给催化日历置顶做精确倒计时，信号条里不重复。
  const disclosureRaw = entitySignals.find((s) => s.kind === "disclosure");
  const appointment = parseAppointmentView(disclosureRaw?.detail);
  // disclosure 一律不进信号条：那张卡的 KIND_LABEL 里没有它，解析失败时会裸显 "disclosure"。
  // 披露节点归催化日历管，解析不出来就干脆不显示（而不是显示个英文 kind）。
  const otherSignals = entitySignals.filter(
    (s) =>
      s.kind !== "disclosure" && !(consensusDetail && s.kind === "consensus"),
  );
  const catalystNodes = quotable ? upcomingDisclosureNodes(new Date(), 2) : [];
  const catalystCatalysts = thesisData?.catalysts ?? [];
  const catalystBlock =
    (entity.type === "COMPANY" || entity.type === "STOCK") &&
    (catalystNodes.length > 0 ||
      catalystCatalysts.length > 0 ||
      appointment) ? (
      <div className="mb-6">
        <CatalystCalendar
          nodes={catalystNodes}
          catalysts={catalystCatalysts}
          appointment={appointment ?? undefined}
          previewHref={appointment ? `/entity/${id}/earnings` : undefined}
        />
      </div>
    ) : null;
  // 事件时间线复盘（P5-11）：材料级信号 + 你的决策，倒序 + 后续印证判定。
  const timeline = buildEventTimeline(thesisSignals.items, decisions);
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
        className="text-muted hover:text-brand text-sm transition-colors"
      >
        ← 首页
      </Link>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-white/10 dark:text-gray-300">
            {entityTypeLabel(entity.type)}
          </span>
          <h1 className={`mt-2 text-2xl lg:text-3xl ${displayCls}`}>
            {displayName}
          </h1>
          {/* 「N 人关注」已去掉（sway 2026-07-31：用户还少的时候「1 人关注」只会减分）。
              于是这行只剩交易所 + 代码，没有代码就整行不渲染，别留个空段落撑高度。 */}
          {quoteTicker ? (
            <p className="text-muted mt-1 text-sm">
              <span className="tabular">
                {displayExchange ?? ""} {quoteTicker}
              </span>
            </p>
          ) : null}
        </div>
        <FollowButton
          entityId={entity.id}
          loggedIn={!!session?.user}
          initialFollowing={following}
        />
      </div>

      {hasRail ? (
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
          {/* 移动端内容层级：原来右栏整块排在主内容**前面**，手机上要先滚过 行情/我的/记分卡/相关
              四张卡（约 1600px）才看得到「投资逻辑」——产品最核心的内容被上下文信息压在下面。
              这里用 display:contents 让 aside 的子卡在移动端直接成为网格项、可各自 order：
              行情(1) → 我的(2) → **主内容(3)** → 记分卡(4) → 相关(5)。
              lg 起 aside 恢复块级（连续 + sticky 右栏），桌面布局完全不变。 */}
          {/* 桌面右栏自己是一个滚动区：卡片叠起来比一屏高（行情+估值+一致预期+记分卡+相关），
              只 sticky 的话下半截够不着——必须连正文一起滚，正文就被带走了。
              `#main-content` 在 lg 起占满 100dvh（顶部 header 是 md:hidden），所以高度预算就是
              100dvh 减掉 top-4 的 1rem 和底部留白 1rem。 */}
          <aside className="contents lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:block lg:max-h-[calc(100dvh-2rem)] lg:space-y-4 lg:self-start lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1">
            {quoteCard ? (
              <div className="order-1 lg:order-none">{quoteCard}</div>
            ) : null}
            {valuationCard ? (
              <div className="order-1 lg:order-none">{valuationCard}</div>
            ) : null}
            {consensusDetail ? (
              <div className="order-1 lg:order-none">
                <ConsensusCard
                  detail={consensusDetail.detail}
                  asOf={consensusDetail.asOf}
                  reportsHref={reportsTabHref(id)}
                  reportCount={newsPage.reportTotal}
                />
              </div>
            ) : null}
            {otherSignals.length > 0 ? (
              <div className="order-1 lg:order-none">
                <SignalStrip signals={otherSignals} />
              </div>
            ) : null}
            {/* 「我的」合并卡：持仓 / 到价提醒 / 决策记录三件「我在这只股上的动作」原本是三张
                独立卡，各带卡壳+图标+大标题+一段说明文案，占满整个右栏、把真正的信息
                （记分卡/相关）推到很下面。合并成一张、用小标题分段、说明文案收敛成底部一行。 */}
            {session?.user ? (
              <section
                id="decision"
                className="divide-line border-brand/25 bg-brand/[0.03] order-2 scroll-mt-20 divide-y rounded-xl border shadow-sm lg:order-none"
              >
                <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                  <span
                    className="bg-brand h-4 w-1.5 rounded-full"
                    aria-hidden
                  />
                  <h3 className="text-ink text-sm font-bold">我的</h3>
                </div>

                <div className="px-4 py-3">
                  <HoldingEditor entityId={id} initial={holding} bare />
                </div>

                {quotable ? (
                  <div className="px-4 py-3">
                    <PriceAlertCard entityId={id} bare />
                  </div>
                ) : null}

                <div className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-muted text-xs font-semibold">
                      决策记录
                    </h4>
                    {decisions.length > 0 ? (
                      <span className="text-muted ml-auto text-[11px]">
                        {decisions.length}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2">
                    <DecisionEditor entityId={id} />
                  </div>
                  {decisions.length > 0 ? (
                    <div className="mt-3">
                      <DecisionList decisions={decisions} />
                    </div>
                  ) : null}
                </div>

                <p className="text-muted px-4 py-2.5 text-[11px] leading-relaxed">
                  持仓与价位是你自己记的观察位，用来判断今天的消息有没有动你的逻辑。非投资建议、不计盈亏。
                </p>
              </section>
            ) : null}
            {news.length > 0 ? (
              <div className="order-4 lg:order-none">
                <NewsScorecard data={scorecard} />
              </div>
            ) : null}
            {relatedFlat.length > 0 && (
              <section className="border-line bg-surface order-5 rounded-xl border p-4 lg:order-none">
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
          <div className="order-3 min-w-0 lg:order-none lg:col-start-1 lg:row-start-1">
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
