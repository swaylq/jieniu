import Link from "next/link";

import type { UserDigestData } from "~/lib/user-digest";
import { DIM_STATE_LABEL, type DimState } from "~/lib/dimension-state";

/** 真实涨跌一律走语义色（铁律：色盲模式靠 text-up/text-down 重映射）；0 值（平盘）走中性灰。 */
function Pct({ v }: { v: number }) {
  return (
    <span
      className={`tabular text-xs ${
        v > 0
          ? "font-semibold text-up"
          : v < 0
            ? "font-semibold text-down"
            : "text-muted"
      }`}
    >
      {v > 0 ? "+" : ""}
      {v.toFixed(2)}%
    </span>
  );
}

function Head({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-ink">
      <span className="tabular text-[11px] font-semibold text-brand">{n}</span>
      {children}
    </h3>
  );
}

/**
 * 每日**个人**复盘卡——首屏第一张。市场那份是背景，这份贴着你的组合写。
 * 所有数字来自服务端计算（模型不产出数值），文字来自 AI。
 */
export function UserBrief({
  tradeDate,
  data,
}: {
  tradeDate: string;
  data: UserDigestData;
}) {
  const p = data.portfolio;
  return (
    <section className="rounded-2xl border border-brand/25 bg-surface p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
        <h2 className="text-base font-bold text-ink">你的今日复盘</h2>
        <span className="tabular text-xs text-muted">{tradeDate}</span>
        <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted">
          按你的持仓生成 · 数字由系统计算
        </span>
      </div>

      <p className="text-[15px] leading-relaxed font-semibold text-ink">{data.headline}</p>

      <p className="mt-2 text-xs leading-relaxed text-muted">
        共 {p.total} 只{p.held > 0 ? `（持仓 ${p.held}）` : ""}
        {p.quoted > 0 ? (
          <>
            {" · "}今日涨 {p.up} 跌 {p.down}
            {p.flat > 0 ? ` 平 ${p.flat}` : ""}
            {p.avgChangePct !== null ? (
              <>
                {" · "}
                {p.weighted ? "按仓位加权" : "均值"} <Pct v={p.avgChangePct} />
              </>
            ) : null}
          </>
        ) : (
          " · 今日暂无行情数据"
        )}
        {p.quoted < p.total ? ` · ${p.total - p.quoted} 只无行情，未计入均值` : ""}
      </p>

      {/* 判断：整张卡的落点 */}
      <div className="mt-3 rounded-xl border border-brand/30 bg-brand/[0.04] px-4 py-3">
        <p className="mb-1 text-[11px] font-bold tracking-wide text-brand">对你的判断</p>
        <p className="text-[13px] leading-relaxed text-ink/85">{data.judgment}</p>
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {p.movers.length > 0 ? (
          <div>
            <Head n={1}>你的标的今天</Head>
            <ul className="space-y-1.5">
              {p.movers.map((m) => (
                <li key={m.name} className="text-[13px] leading-relaxed">
                  <span
                    className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      m.held ? "bg-brand/10 text-brand" : "bg-line/70 text-muted"
                    }`}
                  >
                    {m.held ? "持仓" : "观察"}
                  </span>
                  <span className="font-medium text-ink">{m.name}</span>{" "}
                  <Pct v={m.changePct} />
                  {m.note ? <span className="text-ink/70"> · {m.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {data.exposure.length > 0 ? (
          <div>
            <Head n={2}>你的板块暴露</Head>
            <ul className="space-y-1.5">
              {data.exposure.map((e) => (
                <li key={e.sector} className="text-[13px] leading-relaxed">
                  <span className="font-medium text-ink">{e.sector}</span>{" "}
                  <Pct v={e.sectorChangePct} />
                  <span className="ml-1 rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-muted">
                    {e.signal}
                  </span>
                  <span className="text-muted"> · 你有 {e.stocks.join("、")}</span>
                  {e.note ? <span className="block text-ink/70">{e.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {data.touched.length > 0 ? (
          <div>
            <Head n={3}>触及你的投资逻辑</Head>
            <ul className="space-y-1.5">
              {data.touched.map((t) => (
                <li key={`${t.entityName}-${t.dimensionKey}`} className="text-[13px] leading-relaxed">
                  <span className="font-medium text-ink">{t.entityName}</span>
                  <span className="mx-1 rounded bg-line/60 px-1.5 py-0.5 text-[11px] text-muted">
                    {t.dimensionKey}
                  </span>
                  <span className="text-muted">
                    {DIM_STATE_LABEL[t.fromState as DimState] ?? t.fromState} →{" "}
                    <b className="text-ink">
                      {DIM_STATE_LABEL[t.toState as DimState] ?? t.toState}
                    </b>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {data.watchpoints.length > 0 ? (
          <div>
            <Head n={4}>明天你要看什么</Head>
            <ul className="space-y-1">
              {data.watchpoints.map((w, i) => (
                <li key={i} className="flex gap-1.5 text-[13px] leading-relaxed text-ink/80">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p className="text-[11px] leading-relaxed text-faint">
          依据你的自选、仓位与今日行情由 AI 生成；不构成投资建议，不含买卖指令或目标价。
        </p>
        <Link href="/profile" className="shrink-0 text-xs font-medium text-brand hover:underline">
          管理我的组合 →
        </Link>
      </div>
    </section>
  );
}
