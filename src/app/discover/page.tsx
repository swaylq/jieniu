import Link from "next/link";
import { HoverPrefetchLink } from "../_components/hover-prefetch-link";
import { type Metadata } from "next";

import { api } from "~/trpc/server";
import { EntitySearch } from "../_components/entity-search";
import { SectionHead, chipClass, displayCls } from "../_components/section-head";
import { HotSectorGrid } from "../_components/hot-sector-grid";
import { MarketStrengthMap } from "../_components/market-strength-map";
import { OpportunityRadar } from "../_components/opportunity-radar";
import { Pager } from "../_components/pager";
import { entityTypeLabel } from "~/lib/format";
import { abs, openGraph, twitter } from "~/lib/seo";
import type { EntityType } from "../../../generated/prisma";
import { splitNameCode } from "~/lib/watch-label";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "发现 全 A股行业与个股",
  description:
    "浏览解牛覆盖的全 A股行业、公司、股票与关键人物，看一手资讯与 AI 投资逻辑。",
  alternates: { canonical: "/discover" },
  openGraph: openGraph({
    url: abs("/discover"),
    title: "发现 全 A股行业与个股 · 解牛",
    description: "全 A股按行业全覆盖，一手资讯与 AI 投资逻辑。",
  }),
  twitter: twitter({ title: "发现 全 A股行业与个股 · 解牛" }),
};

const TYPES: EntityType[] = ["SECTOR", "COMPANY", "STOCK", "PERSON"];
// 覆盖扩量后单类可达上千，页面只列前 N 个代表，其余靠上方搜索定位（ZF-3）。
const DISPLAY_CAP = 90;

/** 机会雷达 flag 徽标配色（铁律：无红绿；amber=有原始进展，灰=跟进/升温）。 */
function flagClass(tone: "up" | "neutral") {
  return tone === "up"
    ? "shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand"
    : "shrink-0 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-muted";
}

const TYPE_KEYS = new Set<string>(TYPES);

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const sp = await searchParams;
  // ?type=COMPANY → 进入「某一类的完整分页列表」；不带则是原来的总览页。
  const browseType =
    sp.type && TYPE_KEYS.has(sp.type) ? (sp.type as EntityType) : null;
  if (browseType) {
    const page = Math.max(1, Number(sp.page) || 1);
    const data = await api.entity.listByTypePage({ type: browseType, page });
    return (
      <main className="mx-auto max-w-2xl p-4 lg:max-w-5xl lg:px-8">
        <header className="pt-1">
          <Link href="/discover" className="text-sm text-muted hover:text-brand">
            ← 机会雷达
          </Link>
          <h1 className={`mt-2 text-2xl ${displayCls}`}>
            全部{entityTypeLabel(browseType)}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            共 {data.total} 个 · 按名称排序
          </p>
        </header>
        <div className="mt-4">
          <EntitySearch />
        </div>
        <ul className="mt-6 flex flex-wrap gap-2">
          {data.items.map((e) => (
            <li key={e.id}>
              <HoverPrefetchLink href={`/entity/${e.id}`} className={chipClass}>
                {splitNameCode(e.name).name}
                {(splitNameCode(e.name).code ?? e.ticker) ? (
                  <span className="tabular ml-1.5 text-xs text-muted">
                    {splitNameCode(e.name).code ?? e.ticker}
                  </span>
                ) : null}
              </HoverPrefetchLink>
            </li>
          ))}
        </ul>
        <Pager
          basePath="/discover"
          params={{ type: browseType }}
          page={data.page}
          pages={data.pages}
          total={data.total}
          unit="个"
        />
      </main>
    );
  }

  const [hot, radar, strengthMap, opportunities, sections] = await Promise.all([
    api.entity.allSectors(),
    api.entity.radar(),
    // 加进同一个 Promise.all：多一道串行 await 就多一次全额延迟（个股页 278ms 的教训）
    api.radar.strengthMap(),
    api.radar.opportunities(),
    Promise.all(
      TYPES.map(async (type) => ({
        type,
        items: await api.entity.listByType({ type }),
      })),
    ),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-5xl lg:px-8">
      <header className="pt-1">
        <div className="flex items-center gap-2.5">
          <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
          <h1 className={`text-2xl ${displayCls}`}>
            机会雷达
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted">
          先看今天哪些行业强、哪些行业弱，再看哪些变化可能仍处于早期
        </p>
      </header>

      <div className="mt-4">
        <EntitySearch />
      </div>

      {/* 两个模块**刻意分开**（需求 §1）：
          ① 市场强弱地图只回答「今天哪些行业强/弱」，不把强势或跌得多的行业称作机会；
          ② 机会雷达只出过闸的信号，回答「哪些变化可能仍处于早期」。
          都从 MarketDaily 算好落库，请求路径上不碰任何第三方接口。 */}
      <div className="mt-8 space-y-6">
        <OpportunityRadar
          cards={opportunities.cards}
          risks={opportunities.risks}
          tradeDate={opportunities.tradeDate}
        />
        <MarketStrengthMap
          sectors={strengthMap.sectors}
          tradeDate={strengthMap.tradeDate}
        />
      </div>

      {hot.sectors.length > 0 ? (
        <div className="mt-8">
          <HotSectorGrid
            sectors={hot.sectors}
            totalStocks={hot.totalStocks}
            full
            limit={40}
          />
        </div>
      ) : null}

      {radar.length > 0 ? (
        <section className="mt-8">
          <SectionHead title="有新进展的标的" hint="近 3 天资讯热度 · 纯规则" />
          {/* 徽章含义在这里统一说明一次即可——原来每张卡还各自重复一遍同样的解释句
              （同一 flag 的 hint 是常量，4 张卡 4 句一模一样），属纯重复，已从卡片移除。 */}
          <p className="-mt-1 mb-3 text-xs leading-relaxed text-muted">
            按近期资讯热度排序：<span className="font-medium text-ink">有原始进展</span>
            ＝一手信息多、值得细看；<span className="font-medium text-ink">多为跟进报道</span>
            ＝关注高但新事实少、留意是否被情绪推动；
            <span className="font-medium text-ink">关注升温</span>＝资讯量上升、一手与跟进参半。价格与估值类机会需行情数据，暂未纳入。
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {radar.map((item) => (
              <li key={item.entityId}>
                <HoverPrefetchLink
                  href={`/entity/${item.entityId}`}
                  className="flex h-full items-start justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-brand/40 hover:bg-canvas"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-semibold text-ink">
                        {splitNameCode(item.name).name}
                      </span>
                      {(splitNameCode(item.name).code ?? item.ticker) ? (
                        <span className="tabular shrink-0 text-xs text-muted">
                          {splitNameCode(item.name).code ?? item.ticker}
                        </span>
                      ) : null}
                    </div>
                    <p className="tabular mt-1.5 text-xs text-muted">
                      近 3 天 {item.total} 条
                      {item.primary > 0 ? ` · 一手 ${item.primary}` : ""}
                    </p>
                  </div>
                  <span className={flagClass(item.flagTone)}>
                    {item.flagLabel}
                  </span>
                </HoverPrefetchLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-10">
        <SectionHead title="按分类浏览" />
        {sections.map(({ type, items }) =>
          items.length > 0 ? (
            <section key={type} className="mt-6">
              <div className="mb-2.5 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-ink">
                  {entityTypeLabel(type)}
                </h3>
                <span className="text-xs text-muted">{items.length}</span>
              </div>
              <ul className="flex flex-wrap gap-2">
                {items.slice(0, DISPLAY_CAP).map((e) => (
                  <li key={e.id}>
                    <HoverPrefetchLink href={`/entity/${e.id}`} className={chipClass}>
                      {splitNameCode(e.name).name}
                      {(splitNameCode(e.name).code ?? e.ticker) ? (
                        <span className="tabular ml-1.5 text-xs text-muted">
                          {splitNameCode(e.name).code ?? e.ticker}
                        </span>
                      ) : null}
                    </HoverPrefetchLink>
                  </li>
                ))}
              </ul>
              {items.length > DISPLAY_CAP ? (
                <p className="mt-3 text-xs text-muted">
                  已显示前 {DISPLAY_CAP} / 共 {items.length} ·{" "}
                  <Link
                    href={`/discover?type=${type}`}
                    className="font-medium text-brand hover:underline"
                  >
                    查看全部 →
                  </Link>
                </p>
              ) : null}
            </section>
          ) : null,
        )}

        {sections.every(({ items }) => items.length === 0) && (
          <p className="mt-6 rounded-xl border border-line bg-surface p-6 text-center text-sm text-muted">
            暂无可浏览的实体，数据抓取后会陆续出现在这里。
          </p>
        )}
      </div>
    </main>
  );
}
