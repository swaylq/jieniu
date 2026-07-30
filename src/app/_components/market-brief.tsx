import type { MarketDigestData, DigestDriverOut } from "~/lib/market-digest";
import {
  CATEGORY_LABEL,
  CATEGORIES,
  type EventCategory,
} from "~/lib/digest-pipeline";

export type MarketBriefProps = {
  tradeDate: string;
  data: MarketDigestData;
  /** 紧凑版：概况 + 宽度 + 三层核心驱动 + 判断，省掉板块/个股/关注点（个人复盘在场时用） */
  compact?: boolean;
};

function SectionTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-ink">
      <span className="tabular text-[11px] font-semibold text-brand">{n}</span>
      {children}
    </h3>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((t, i) => (
        <li key={i} className="flex gap-1.5 text-[13px] leading-relaxed text-ink/80">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** 涨跌只用字重与符号表达，不用红绿——全站配色铁律（强调一律 amber）。 */
function Pct({ v }: { v: number | null }) {
  if (v === null) return null;
  return (
    <span className={`tabular text-xs ${v >= 0 ? "font-semibold text-ink" : "text-muted"}`}>
      {v >= 0 ? "+" : ""}
      {v.toFixed(2)}%
    </span>
  );
}

/** 六类的展示顺序＝张楚寒给的顺序：宏观、全球市场、行业、公司、资金、日历。
 * 这里把「全球市场」放最前——A 股当天最大的外生变量常常在隔夜海外。 */
const SCOPE_ORDER: EventCategory[] = [...CATEGORIES];

/** 紧凑版每类最多几条。六类 × 2 = 最多 12 条，比原来三层 × 3 更多，也不至于铺满首屏。 */
const COMPACT_PER_SCOPE = 2;

function DriverGroup({
  scope,
  items,
}: {
  scope: EventCategory;
  items: DigestDriverOut[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="h-3 w-1 rounded-full bg-brand/60" aria-hidden />
        <span className="text-[11px] font-bold tracking-wide text-brand">
          {CATEGORY_LABEL[scope]}
        </span>
      </div>
      <Bullets items={items.map((d) => d.text)} />
    </div>
  );
}

/**
 * 市场宽度条：**指数会骗人**——权重护盘时指数只跌 0.5%，可能 4000 只在跌。
 * 「今天到底是什么盘」靠这一行，而且它每天都不一样（张楚寒：「说的都是正确的废话，
 * 每天都可以写一样的话」——数字是天然的反废话）。
 */
function BreadthStrip({ b }: { b: NonNullable<MarketDigestData["breadth"]> }) {
  const cell = (label: string, value: React.ReactNode) => (
    <div key={label} className="min-w-0">
      <div className="text-[10px] tracking-wide text-faint">{label}</div>
      <div className="tabular mt-0.5 text-[13px] font-semibold text-ink">{value}</div>
    </div>
  );
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-line bg-canvas/60 px-4 py-3 sm:grid-cols-4">
      {cell("上涨 / 下跌", `${b.up} / ${b.down}`)}
      {cell("涨停 / 跌停", `${b.limitUp} / ${b.limitDown}`)}
      {cell(
        "个股中位涨跌",
        b.medianChangePct === null ? "—" : <Pct v={b.medianChangePct} />,
      )}
      {cell("统计样本", `${b.counted} 只`)}
    </div>
  );
}

/**
 * 每日 AI 市场复盘卡（首屏）。
 *
 * 2026-07-29 改版（张楚寒：「我感觉太简略了」「看似复盘 实则没内容」「我想要这里放信息量，就是
 * 国际市场有啥大事、国内整体有啥大事」）：核心驱动按层铺开，上面压一条代码算出来的市场宽度；
 * 紧凑版不再退化成「一句概况 + 判断」——那两句正是被吐槽「每天都能写一样」的部分。
 *
 * 2026-07-30 再改：分层从三层扩到**六类**（全球市场 / 国内宏观 / 行业 / 公司 / 资金 / 日历），
 * 与复盘生成侧的六步事件管线对齐。老数据里的 overseas/domestic 由 `normalizeScope` 映射过来。
 */
export function MarketBrief({ tradeDate, data, compact }: MarketBriefProps) {
  const hasSectors = data.sectors.strong.length + data.sectors.weak.length > 0;
  const byScope = (s: EventCategory) => data.drivers.filter((d) => d.scope === s);
  /**
   * 紧凑版**不再削核心驱动**。2026-07-30 sway：「还是觉得这块信息不足」——他看的就是首页这版，
   * 而库里当天有 5 条 driver，这里只渲染出 3 条（国际1/国内1/产业1）：老逻辑是
   * 「国际2 + 国内2，凑不满 3 条才拿产业补」，产业那一整层实际上只露一条。
   * 「紧凑」应该省掉的是板块/个股/关注点（下面 `compact ? null :` 那段），不是这三层大事。
   */
  const compactDrivers: DigestDriverOut[] = SCOPE_ORDER.flatMap((s) =>
    byScope(s).slice(0, COMPACT_PER_SCOPE),
  );

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
        <h2 className="text-base font-bold text-ink">今日复盘</h2>
        <span className="tabular text-xs text-muted">{tradeDate}</span>
        <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted">
          AI 生成 · 仅归纳已发生事实
        </span>
      </div>

      <p className="text-sm leading-relaxed text-ink/85">{data.overview}</p>

      {data.breadth ? <BreadthStrip b={data.breadth} /> : null}

      {compact ? (
        compactDrivers.length > 0 ? (
          <div className="mt-4 space-y-3">
            {SCOPE_ORDER.map((s) => (
              <DriverGroup
                key={s}
                scope={s}
                items={compactDrivers.filter((d) => d.scope === s)}
              />
            ))}
          </div>
        ) : null
      ) : null}

      {/* 判断：整张卡的落点 */}
      <div className="mt-4 rounded-xl border border-brand/30 bg-brand/[0.04] px-4 py-3">
        <p className="mb-1 text-[11px] font-bold tracking-wide text-brand">判断</p>
        <p className="text-[13px] leading-relaxed text-ink/85">{data.judgment}</p>
      </div>

      {compact ? null : (
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {data.drivers.length > 0 ? (
            <div className="space-y-3.5 sm:col-span-2">
              <SectionTitle n={2}>今日核心驱动</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-3">
                {SCOPE_ORDER.map((s) => (
                  <DriverGroup key={s} scope={s} items={byScope(s)} />
                ))}
              </div>
            </div>
          ) : null}

          {hasSectors ? (
            <div>
              <SectionTitle n={3}>强弱板块</SectionTitle>
              <ul className="space-y-1.5">
                {data.sectors.strong.map((s) => (
                  <li key={`s-${s.name}`} className="text-[13px] leading-relaxed">
                    <span className="mr-1.5 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                      强
                    </span>
                    <span className="font-medium text-ink">{s.name}</span>
                    {s.note ? <span className="text-ink/70"> · {s.note}</span> : null}
                  </li>
                ))}
                {data.sectors.weak.map((s) => (
                  <li key={`w-${s.name}`} className="text-[13px] leading-relaxed">
                    <span className="mr-1.5 rounded bg-line/70 px-1.5 py-0.5 text-[11px] font-medium text-muted">
                      弱
                    </span>
                    <span className="font-medium text-ink">{s.name}</span>
                    {s.note ? <span className="text-ink/70"> · {s.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.stocks.length > 0 ? (
            <div>
              <SectionTitle n={4}>重点个股</SectionTitle>
              <ul className="space-y-1.5">
                {data.stocks.map((s) => (
                  <li key={s.name} className="text-[13px] leading-relaxed">
                    <span className="mr-1.5 font-medium text-ink">{s.name}</span>
                    <Pct v={s.changePct} />
                    {s.note ? <span className="text-ink/70"> · {s.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.watchpoints.length > 0 ? (
            <div className="sm:col-span-2">
              <SectionTitle n={5}>下一交易日关注点</SectionTitle>
              <Bullets items={data.watchpoints} />
            </div>
          ) : null}
        </div>
      )}

      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
        依据当日指数、涨跌家数、板块资金、公开公告与已知披露日程由 AI 归纳生成；
        数字由系统统计，不构成投资建议，不含买卖指令或目标价。
      </p>
    </section>
  );
}
