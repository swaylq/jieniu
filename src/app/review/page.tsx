import Link from "next/link";

import { api } from "~/trpc/server";
import { auth } from "~/server/auth";
import {
  summarizeReview,
  partitionPortfolioChange,
  CHANGE_LABEL,
  changeTone,
  changeObservation,
} from "~/lib/portfolio-change";
import { ACTION_LABEL, normalizeAction } from "~/lib/decision";
import { streamStamp } from "~/lib/format";
import { primaryBtn } from "../_components/section-head";

export const dynamic = "force-dynamic";

function Masthead() {
  return (
    <header className="pt-1 pb-4">
      <div className="flex items-center gap-2.5">
        <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          过去 30 天回顾
        </h1>
      </div>
      <p className="mt-2 text-sm text-muted">
        你的持仓这一个月，投资逻辑发生了什么变化——纯依据触及逻辑的资讯，非涨跌复盘。
      </p>
    </header>
  );
}

function actionLabel(a: string): string {
  return a === "NOTE" ? "笔记" : (ACTION_LABEL[normalizeAction(a)] ?? a);
}

export default async function ReviewPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <main className="mx-auto max-w-2xl p-4 lg:max-w-4xl">
        <Masthead />
        <div className="mt-2 rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-muted">登录后查看你持仓过去 30 天的逻辑变化回顾</p>
          <Link href="/login?returnTo=/review" className={`mt-4 ${primaryBtn}`}>
            邮箱登录
          </Link>
        </div>
      </main>
    );
  }

  const [items, decisions] = await Promise.all([
    api.portfolio.changed({ days: 30 }),
    api.decision.listMine({ take: 20 }),
  ]);
  const summary = summarizeReview(items);
  const { changed, muted } = partitionPortfolioChange(items);
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentDecisions = decisions.filter(
    (d) => new Date(d.createdAt).getTime() >= since,
  );

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-4xl">
      <Masthead />

      {/* 汇总一句话 + 计数 */}
      <section className="rounded-2xl border border-brand/30 bg-brand/[0.05] p-4 lg:p-5">
        <p className="text-sm font-semibold leading-relaxed text-ink">
          {summary.headline}
        </p>
        {summary.total > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-brand/15 px-2.5 py-1 font-medium text-brand">
              逻辑增强 {summary.strengthened}
            </span>
            <span className="rounded-full border border-line px-2.5 py-1 font-medium text-ink">
              风险信号 {summary.weakened}
            </span>
            <span className="rounded-full px-2.5 py-1 font-medium text-muted">
              无变化 {summary.unchanged}
            </span>
          </div>
        ) : (
          <Link href="/discover" className={`mt-4 ${primaryBtn}`}>
            去发现并标记持仓 →
          </Link>
        )}
      </section>

      {/* 有变化的持仓 */}
      {changed.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-3 text-base font-bold text-ink">有变化的持仓</h2>
          <ul className="space-y-3">
            {changed.map((c) => {
              const accent = changeTone(c.direction) === "accent";
              return (
                <li
                  key={c.entityId}
                  className="rounded-xl border border-line bg-surface p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/entity/${c.entityId}`}
                      className="font-semibold text-ink transition-colors hover:text-brand"
                    >
                      {c.name}
                    </Link>
                    <span
                      className={
                        accent
                          ? "rounded bg-brand/15 px-1.5 py-0.5 text-[11px] font-semibold text-brand"
                          : "rounded border border-line px-1.5 py-0.5 text-[11px] font-semibold text-ink"
                      }
                    >
                      {CHANGE_LABEL[c.direction]}
                    </span>
                    {c.topDimension ? (
                      <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] text-brand">
                        {c.topDimension}
                      </span>
                    ) : null}
                    <span className="ml-auto text-[11px] text-muted">
                      {c.materialCount} 条材料动态
                    </span>
                  </div>
                  {c.topNote ? (
                    <p className="mt-1.5 text-sm leading-relaxed text-ink/85">
                      {c.topNote}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    {changeObservation(c.direction)}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* 无实质变化的持仓（静音） */}
      {muted.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-muted">
            无实质变化 · {muted.length}
          </h2>
          <div className="flex flex-wrap gap-2">
            {muted.map((m) => (
              <Link
                key={m.entityId}
                href={`/entity/${m.entityId}`}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-brand hover:text-brand"
              >
                {m.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* 你这一个月的决策 */}
      {recentDecisions.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-3 text-base font-bold text-ink">你这一个月的决策</h2>
          <ul className="space-y-2.5">
            {recentDecisions.map((d) => (
              <li
                key={d.id}
                className="rounded-xl border border-line bg-surface p-3.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/entity/${d.entity.id}`}
                    className="font-semibold text-ink transition-colors hover:text-brand"
                  >
                    {d.entity.name}
                  </Link>
                  <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                    {actionLabel(d.action)}
                  </span>
                  <span className="ml-auto text-[11px] text-muted tabular">
                    {streamStamp(new Date(d.createdAt))}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink/85">
                  {d.reason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 text-[11px] leading-relaxed text-muted">
        本回顾只汇总触及你投资逻辑的资讯动态与你自己的决策记录；不含股价涨跌复盘（需行情数据）、非投资建议、不预测涨跌。
      </p>
    </main>
  );
}
