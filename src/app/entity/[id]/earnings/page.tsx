import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { type Metadata } from "next";

import { api } from "~/trpc/server";
import { abs, openGraph, twitter } from "~/lib/seo";
import { parseAppointmentView, parseLocalDay } from "~/lib/disclosure";
import { parseConsensusDetail } from "~/lib/consensus";
import { earningsCheckable } from "~/lib/earnings-check";
import { isAShareTicker } from "~/lib/quote";
import { ConsensusCard } from "../../../_components/consensus-card";
import { ThesisEarningsCheck } from "../../../_components/thesis-earnings-check";
import { EarningsReactionSection, ReactionSkeleton } from "./reaction-section";

export const dynamic = "force-dynamic";

const getPreview = cache((id: string) => api.earnings.preview({ id }));

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(target: Date, now: Date): number {
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

function fmtMd(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await getPreview(id);
  // 找不到时返回 noindex，**不要**在这里 notFound()。
  // Next 15.5 对 force-dynamic 路由的行为：notFound() 会被 not-found 边界在流内正常渲染，
  // 不会冒泡到 app-render 那个设 res.statusCode=404 的 catch（见 app-render.js:1402），
  // 所以状态码留在 200（soft 404）。实测在 generateMetadata 里抛也一样是 200。
  // 状态码改不动，就退而求其次堵住真正的危害：noindex 让爬虫不收录不存在的实体页。
  // 页面组件里的 notFound() 保留——它负责渲染友好的「页面不存在」。
  if (!data) return { title: "未找到", robots: { index: false, follow: false } };
  const title = `${data.entity.name} 财报前瞻 · 解牛`;
  const description = `${data.entity.name}下次定期报告的预约披露日、机构一致预期、业绩预告与历史财报日反应，以及这次财报能验证投资逻辑的哪几条。`;
  const url = abs(`/entity/${id}/earnings`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: openGraph({ title, description, url }),
    twitter: twitter({ title, description }),
  };
}

/**
 * 财报前瞻页（事件页范式，借鉴富途「牛牛财报站」）。
 *
 * 富途那一页的组织单位是**一次财报事件**而不是公司——所有模块围绕「这次业绩」，
 * 事件过完换下一期，用日程自带的紧迫感回答「今天为什么要打开」。解牛此前只有
 * 「标的页 + 时间轴」，缺这个落点。
 *
 * 与富途的分工差异：它整页在做**市场预期定价**（一致预期 → 大行分歧 → 期权隐含波动 →
 * 历史波动），闭环到期权下单；解牛不做交易，所以把闭环换成 **thesis 校验**——
 * 「这次财报会验证你写下的哪几条」。富途没有 thesis 这个对象，抄不了这一步。
 *
 * 刻意**不做**的：期权组合 / 盈利概率 / 最大盈利——那是券商能放的东西，直接踩
 * 「不出买卖建议、不做收益承诺」的红线。
 */
export default async function EarningsPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getPreview(id);
  if (!data) notFound();

  const { entity, ticker, disclosure, consensus, forecast, thesis, userThesis } =
    data;
  const now = new Date();

  const appointment = parseAppointmentView(disclosure?.detail);
  const apptDate = appointment ? parseLocalDay(appointment.date) : null;
  const apptDays = apptDate ? daysBetween(apptDate, now) : null;
  const upcoming =
    appointment && apptDate && apptDays !== null && apptDays >= 0
      ? { ...appointment, at: apptDate, daysUntil: apptDays }
      : null;

  const consensusDetail = parseConsensusDetail(consensus?.detail);

  // 用户自有逻辑优先；没采纳则退回共享框架，并在卡片上说清所有权。
  const dimSource = userThesis ? "user" : "shared";
  const checkable = earningsCheckable(
    userThesis?.dimensions ?? thesis?.dimensions,
    6,
  );

  // 公司页自己没有 ticker，取配对 STOCK 的代码——否则公司页永远出不来历史反应。
  const canReact = isAShareTicker(ticker);

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-3xl lg:px-8">
      <Link
        href={`/entity/${id}`}
        className="text-sm text-muted transition-colors hover:text-brand"
      >
        ← {entity.name}
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-ink lg:text-3xl">
        财报前瞻
      </h1>
      <p className="mt-1 text-sm text-muted">
        {entity.ticker ? (
          <span className="tabular">
            {entity.exchange ?? ""} {entity.ticker} ·{" "}
          </span>
        ) : null}
        {entity.name}
      </p>

      {/* 倒计时头：整页的锚。没有预约日就诚实说没有，不用法定截止日冒充精确日期。 */}
      <section className="mt-5 rounded-2xl border border-brand/25 bg-brand/[0.04] p-4 lg:p-5">
        {upcoming ? (
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted">下次定期报告</p>
              <p className="mt-0.5 text-lg font-bold text-ink">
                {upcoming.periodLabel}
                {upcoming.rescheduled ? (
                  <span className="ml-2 rounded bg-line/70 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-muted">
                    已改期
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                预约 {fmtMd(upcoming.at)} 披露 · 交易所预约披露时间表
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-3xl font-bold text-brand">
                {upcoming.daysUntil}
              </p>
              <p className="text-xs text-muted">天后</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            暂无该股下一期的预约披露日（可能已披露完本期，或交易所时间表尚未更新）。不臆测披露时点。
          </p>
        )}
      </section>

      {/* 业绩预告：A 股独有的强前瞻信号——公司自己给出的净利区间，富途美股页没有对应物 */}
      {forecast ? (
        <section className="mt-6 rounded-2xl border border-line bg-surface p-4 lg:p-5">
          <div className="flex items-center gap-2">
            <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
            <h2 className="text-base font-bold text-ink">业绩预告</h2>
          </div>
          <Link
            href={`/news/${forecast.id}`}
            className="mt-2 block text-sm leading-relaxed font-semibold text-ink transition-colors hover:text-brand"
          >
            {forecast.title}
          </Link>
          <p className="mt-1 text-xs text-muted">
            {forecast.publishedAt.toLocaleDateString("zh-CN")} 披露 ·
            公司法定预告，非预测
          </p>
        </section>
      ) : null}

      {consensusDetail ? (
        <div className="mt-6">
          <ConsensusCard
            detail={consensusDetail}
            asOf={consensus!.asOf}
            title="机构对这期的预期"
          />
        </div>
      ) : null}

      {/* 历史财报日反应走外部 K 线接口（东财/新浪），单独 Suspense——外部接口再慢只慢它自己 */}
      {canReact && ticker ? (
        <div className="mt-6">
          <Suspense fallback={<ReactionSkeleton />}>
            <EarningsReactionSection ticker={ticker} />
          </Suspense>
        </div>
      ) : null}

      {checkable.length > 0 ? (
        <div className="mt-6">
          <ThesisEarningsCheck
            dimensions={checkable}
            source={dimSource}
            periodLabel={upcoming?.periodLabel}
          />
        </div>
      ) : null}

      <p className="mt-8 text-[11px] leading-relaxed text-muted">
        本页汇总的是已披露的确定性日程与第三方机构口径，以及已发生的历史统计。
        解牛不预测财报结果、不预测涨跌、不提供买卖建议或收益承诺。
      </p>
    </main>
  );
}
