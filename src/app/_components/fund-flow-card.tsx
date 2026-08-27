/**
 * 个股「资金」卡 —— 服务端组件，零 JS。
 *
 * 版式上的三条，都是 2026-08-27 摸源结论的直接后果，改版时别拆：
 *
 * ① **头条是档位 + 分位，不是金额。** 同一天同一只股，新浪与东财的主力净额中位数差
 *    50.9%、最大 163.7%。把「+1.26 亿」摆成结论就是假精确。金额降级为次级信息、
 *    只到 0.1 亿，并且始终跟着「估算」二字。
 * ② **中小单不摆成第二条证据。** 成交必然一买一卖，四档之和恒为 0，所以
 *    「中小单净流出」永远等于「主力净流入」的相反数（实测东财 8-27 生益科技分毫不差）。
 *    东财并排摆三行，用户读成「主力在进、散户在跑」，其实只看到一个数被切了三刀。
 *    这里只写一句话点明镜像关系，不给它独立的视觉权重。
 * ③ **超大单/大单可以并排**——它们确实是加法关系（主力 = 超大单 + 大单），不是镜像。
 *
 * 配色：全部走中性墨阶（`text-ink` / `text-muted` / `text-faint`）。
 * 涨跌色只给**价格**那一处——DESIGN.md 铁律③，资金数字染色会和涨跌语义打架。
 */

import Link from "next/link";

import type { FundFlowCard as Card } from "~/lib/fund-flow";
import { isStale, stalenessDays, topPct, yi } from "~/lib/fund-flow";

const PATTERN_LABEL: Record<Card["pattern"], string> = {
  resonance: "资金与价格同向",
  accumulation: "资金先动，价格未反映",
  distribution: "价格在涨，资金在退",
  capitulation: "资金与价格同向走弱",
  spike: "单日资金异常",
  none: "无明确组合",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-muted shrink-0 text-xs">{label}</span>
      <span className="text-ink/90 min-w-0 text-right text-[13px] tabular-nums">
        {children}
      </span>
    </div>
  );
}

/** 净额 → 「净流入 1.3 亿」/「净流出 1.3 亿」。方向用词表达，不用颜色。 */
function flowText(v: number | null): string {
  if (v === null) return "—";
  return `净${v >= 0 ? "流入" : "流出"} ${yi(v)}`;
}

function pctText(v: number | null): string {
  return v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function FundFlowCard({
  card,
  today,
  entityId,
  hasTraces,
}: {
  card: Card;
  /** 服务端算好的本地日历日 YYYY-MM-DD（不要在组件里 `new Date()`，那会按渲染机器的时区走）。 */
  today: string;
  entityId: string;
  /** 这只股当前有没有机构痕迹。没有就不画那条指路链接——锚点会落空。 */
  hasTraces: boolean;
}) {
  // 连今日净额都没有，整张卡不渲染——「空态四格全写未设置」不是信息是噪音（观察卡那轮的教训）。
  if (card.today.netAmount === null) return null;

  const stale = isStale(card.asOf, today);
  const lag = stalenessDays(card.asOf, today);
  const { xlNet, bigNet } = card.today;

  return (
    <section className="border-line bg-surface rounded-xl border p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-ink text-base font-bold">资金</h2>
        <span className="text-faint text-[11px]">
          {card.asOf}
          {stale ? ` · 已落后 ${lag} 天` : ""}
        </span>
      </div>

      {/* 头条：档位 + 分位。金额刻意不在这一行。 */}
      <p className="text-ink text-sm leading-relaxed">
        大资金强度 <span className="font-semibold">{card.band}</span>
        {card.selfPct !== null ? (
          <span className="text-muted">
            {" "}
            · 近 60 个交易日{topPct(card.selfPct)}
          </span>
        ) : null}
        {card.marketPct !== null ? (
          <span className="text-muted"> · 全市场{topPct(card.marketPct)}</span>
        ) : null}
      </p>

      {stale ? (
        <p className="border-line text-muted mt-2 rounded-lg border border-dashed px-2.5 py-1.5 text-[12px] leading-relaxed">
          这张卡用的是 {card.asOf} 的数据，距今 {lag} 天。逐日行情回补最近没跑通，
          在补上之前，下面所有数字都不是今天的。
        </p>
      ) : null}

      <p className="text-muted mt-2 text-[13px] leading-relaxed">
        {card.headline}
      </p>

      <div className="border-line mt-3 border-t pt-1">
        {/* 标签用「当日」不用「今日」：数据可能落后（卡头已标 as-of），写「今日」就是错的。 */}
        <Row label="当日">
          {flowText(card.today.netAmount)}
          {card.today.netRatio !== null ? (
            <span className="text-muted">
              {" "}
              · 占成交额 {Math.abs(card.today.netRatio * 100).toFixed(1)}%
            </span>
          ) : null}
        </Row>
        {xlNet !== null && bigNet !== null ? (
          // 超大单 + 大单 = 主力，是加法关系，可以并排。
          <Row label="其中">
            超大单 {flowText(xlNet)} · 大单 {flowText(bigNet)}
          </Row>
        ) : null}
        <Row label="5 日">
          {flowText(card.sums.d5)}
          <span className="text-muted"> · {card.posDays.d5}/5 天为流入</span>
        </Row>
        <Row label="20 日">
          {flowText(card.sums.d20)}
          <span className="text-muted"> · {card.posDays.d20}/20 天为流入</span>
        </Row>
        <Row label="同期股价">
          {/* 这一行是全卡唯一允许染涨跌色的地方。 */}
          <span
            className={
              card.returns.d5 === null
                ? ""
                : card.returns.d5 >= 0
                  ? "text-up"
                  : "text-down"
            }
          >
            5 日 {pctText(card.returns.d5)}
          </span>
          <span className="text-muted"> · </span>
          <span
            className={
              card.returns.d20 === null
                ? ""
                : card.returns.d20 >= 0
                  ? "text-up"
                  : "text-down"
            }
          >
            20 日 {pctText(card.returns.d20)}
          </span>
        </Row>
        {card.streak !== 0 ? (
          <Row label="连续">
            {Math.abs(card.streak)} 个交易日净
            {card.streak > 0 ? "流入" : "流出"}
          </Row>
        ) : null}
        {card.amountRatio20 !== null ? (
          <Row label="量能">
            当日成交额是近 20 日均量的 {card.amountRatio20.toFixed(1)} 倍
          </Row>
        ) : null}
      </div>

      <p className="text-muted border-line mt-3 border-t pt-2 text-[12px] leading-relaxed">
        <span className="text-faint">读法</span> {PATTERN_LABEL[card.pattern]}。
        {/* 镜像关系写成一句话，不给它独立的视觉权重——它不是第二条证据。 */}
        {card.today.netAmount !== null ? (
          <>
            {" "}
            与之对应的「中小单净{card.today.netAmount >= 0 ? "流出" : "流入"}
            」金额完全相同：成交必然一买一卖，那是同一个数的镜像，不是另一条线索。
          </>
        ) : null}
      </p>

      <ul className="text-faint mt-2 space-y-1 text-[11px] leading-relaxed">
        {card.caveats.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>

      {hasTraces ? (
        <p className="text-faint mt-2 text-[11px]">
          想看真实披露的机构买卖（龙虎榜机构专用席位、大宗交易），见下方
          <Link
            href={`/entity/${entityId}#institutional`}
            className="hover:text-ink underline underline-offset-2 transition-colors"
          >
            机构痕迹
          </Link>
          。
        </p>
      ) : null}
    </section>
  );
}
