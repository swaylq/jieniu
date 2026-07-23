import Link from "next/link";

import { NewsTimeline, type StreamItem } from "./news-timeline";
import { chipClass, displayCls, primaryBtn } from "./section-head";

type Watched = { id: string; name: string; type: string };

/** 大标题（自选股为中心的首页主角）。 */
function HeroTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
      <h1 className={`text-2xl ${displayCls}`}>
        {title}
      </h1>
      {count !== undefined ? (
        <span className="text-sm font-medium text-muted">· {count}</span>
      ) : null}
    </div>
  );
}

/**
 * 首页主角「我的自选股」（Phase 3 P3-2 · 降噪，只看你在乎的）。
 * 三态：未登录（价值主张+CTA）/ 已登录空（建自选股 CTA）/ 已登录有票（自选股 chips + 个性化时间轴）。
 */
export function MyWatchlist({
  loggedIn,
  watched,
  news,
}: {
  loggedIn: boolean;
  watched: Watched[];
  news: StreamItem[];
}) {
  if (!loggedIn) {
    return (
      <section className="mt-6 overflow-hidden rounded-2xl border border-brand/30 bg-brand/[0.05] p-6">
        <HeroTitle title="你的自选股 · 投资逻辑监控" />
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          只看你在乎的 3–10 只票——公司、所在行业、竞品的一举一动。AI 为每只票生成投资逻辑框架，只有触及框架的实质变化才提醒你，其余静音。
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/login" className={primaryBtn}>
            登录建立自选股
          </Link>
          <Link
            href="/onboarding"
            className="inline-flex items-center rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-brand hover:text-brand"
          >
            先挑感兴趣的 →
          </Link>
        </div>
      </section>
    );
  }

  if (watched.length === 0) {
    return (
      <section className="mt-6 rounded-2xl border border-brand/30 bg-brand/[0.05] p-6">
        <HeroTitle title="我的自选股" />
        <p className="mt-2 text-sm leading-relaxed text-muted">
          还没有自选股。建立你的关注，首页只留你在乎的公司 + 行业 + 竞品。
        </p>
        <Link href="/onboarding" className={`mt-4 inline-flex ${primaryBtn}`}>
          挑选自选股 →
        </Link>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <div className="flex items-end justify-between gap-3">
        <HeroTitle title="我的自选股" count={watched.length} />
        <Link
          href="/onboarding"
          className="shrink-0 text-sm text-brand hover:underline"
        >
          管理 →
        </Link>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2">
        {watched.map((e) => (
          <li key={e.id}>
            <Link href={`/entity/${e.id}`} className={chipClass}>
              {e.name}
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {news.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-muted">
            自选股暂无最新动态，静音中。
          </p>
        ) : (
          <NewsTimeline items={news.slice(0, 8)} />
        )}
      </div>

      {news.length > 0 ? (
        <Link
          href="/feed"
          className="mt-3 inline-block text-sm text-brand hover:underline"
        >
          查看全部动态 →
        </Link>
      ) : null}
    </section>
  );
}
