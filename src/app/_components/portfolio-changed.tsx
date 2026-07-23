import Link from "next/link";

import {
  CHANGE_LABEL,
  changeTone,
  changeObservation,
  partitionPortfolioChange,
  type PortfolioChangeItem,
} from "~/lib/portfolio-change";

/** 「今天你的组合变了什么」（P4-4）：按持仓聚合近期信号 → 每票 增强/削弱/未变 + 原因 + 观察建议。宁少毋滥。 */
export function PortfolioChanged({ items }: { items: PortfolioChangeItem[] }) {
  // 无持仓：引导录入（这是产品的入口，不是空态）。
  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-brand/30 bg-brand/[0.05] p-5">
        <div className="flex items-center gap-2">
          <span aria-hidden>🐂</span>
          <h2 className="text-base font-bold text-ink">今天你的组合变了什么</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          记录你的持仓，解牛每天只回答一件事：今天的消息，有没有改变你当初买入的逻辑。
        </p>
        <Link
          href="/discover"
          className="mt-3 inline-block rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/20"
        >
          去发现并标记持仓 →
        </Link>
      </section>
    );
  }

  const { changed, muted } = partitionPortfolioChange(items);
  // 全静时收敛：首页 hero 已经说过「今天都很平静，没有需要复核的变化」，统计卡也已给出
  // 需要复核 0 / 今日静音 N。这里再用一张高亮大卡复述一遍纯属重复——降级成中性紧凑卡，
  // 只保留真正有信息量的那行（哪几支静音）。有变化时维持原来的高亮强调。
  const quiet = changed.length === 0;

  return (
    <section
      className={
        quiet
          ? "rounded-2xl border border-line bg-surface p-4"
          : "rounded-2xl border border-brand/30 bg-brand/[0.05] p-5"
      }
    >
      <div className="flex items-center gap-2">
        {!quiet ? <span aria-hidden>🐂</span> : null}
        <h2
          className={
            quiet
              ? "text-sm font-semibold text-muted"
              : "text-base font-bold text-ink"
          }
        >
          今天你的组合变了什么
        </h2>
        <span className="ml-auto shrink-0 text-[11px] text-muted">
          近 7 天 · 只看动了逻辑的
        </span>
      </div>

      {quiet ? null : (
        <ul className="mt-3 space-y-2.5">
          {changed.map((c) => {
            const accent = changeTone(c.direction) === "accent";
            return (
              <li
                key={c.entityId}
                className="rounded-xl border border-line/70 bg-surface p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/entity/${c.entityId}`}
                    className="text-sm font-semibold text-ink hover:text-brand"
                  >
                    {c.name}
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      accent ? "bg-brand/15 text-brand" : "bg-line/60 text-muted"
                    }`}
                  >
                    {CHANGE_LABEL[c.direction]}
                  </span>
                  {c.topDimension ? (
                    <span className="text-[11px] text-muted">· {c.topDimension}</span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-[11px] text-muted">
                    {c.materialCount} 条材料动态
                  </span>
                </div>
                {c.topNote ? (
                  <p className="mt-1.5 text-xs leading-relaxed text-ink/85">
                    {c.topNote}
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  观察 · {changeObservation(c.direction)}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {muted.length > 0 ? (
        <p
          className={`text-[11px] leading-relaxed text-muted ${
            quiet ? "mt-2" : "mt-3 border-t border-line/60 pt-3"
          }`}
        >
          今日无异动 · {muted.length} 支已静音：{muted.map((m) => m.name).join("、")}
        </p>
      ) : null}

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        {quiet
          ? "非投资建议、不预测涨跌。"
          : "仅汇总触及你持仓监控维度的动态，帮你判断「今天要不要重看逻辑」；非投资建议、不构成买卖依据、不预测涨跌。"}
      </p>
    </section>
  );
}
