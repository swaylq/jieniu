import Link from "next/link";
import type { RadarCard } from "~/server/api/routers/radar";
import { splitNameCode } from "~/lib/watch-label";

/**
 * 机会雷达（需求 §1-2 / §8）。
 *
 * 只展示真正过闸的信号：每天最多 3 个行业、每个行业最多 2 只个股、总数不超过 8 个。
 * 没有合格信号就直接说没有——**不为填满页面降低标准**。
 *
 * 前台只出现「强 / 中」，绝不出现 76.3 这种假精确分数（§4）。原始指标全部藏在
 * 「展开数据」里，默认折叠——通俗结论在前，可复核的数字在后。
 */

const TYPE_LABEL: Record<RadarCard["signalType"], string> = {
  EARLY: "刚刚启动",
  CONFIRMED: "趋势形成",
  RELATIVE_STRENGTH: "逆势走强",
};

const TYPE_HINT: Record<RadarCard["signalType"], string> = {
  EARLY: "资金明显流入、板块表现开始改善，但价格尚未大幅上涨",
  CONFIRMED: "资金连续流入、多数股票同步上涨，趋势已被市场确认",
  RELATIVE_STRENGTH: "行业整体较弱，但这家公司因独立催化明显跑赢行业",
};

/** 铁律：无红绿。amber=行业级/早期，中性=个股级。 */
const TYPE_CLS: Record<RadarCard["signalType"], string> = {
  EARLY: "bg-brand/15 text-brand",
  CONFIRMED: "bg-brand/25 text-brand-dark",
  RELATIVE_STRENGTH: "border border-line text-muted",
};

function Section({ label, body }: { label: string; body: string }) {
  return (
    <div className="mt-2.5">
      <div className="text-muted text-[11px] font-semibold tracking-wide">
        {label}
      </div>
      <p className="text-ink mt-0.5 text-[13px] leading-relaxed">{body}</p>
    </div>
  );
}

/** 0..1 的比例字段：直接显示 1 会被读成「1 家」而不是「100%」。 */
const SHARE_KEYS = new Set([
  "upShare",
  "upShareAvg5",
  "limitUpShare",
  "netRatioToday",
  "top2Concentration",
  "top3Concentration",
]);
/** 分位 / 得分：整数就够——小数点后两位是假精确（§4 的同一条理由）。 */
const ROUND_KEYS = new Set([
  "fundScore",
  "fundPct",
  "fundPctInSector",
  "selfAnomalyPct",
]);

function fmt(v: unknown, key?: string): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v !== "number") return JSON.stringify(v);
  if (!Number.isFinite(v)) return "—";
  if (key && SHARE_KEYS.has(key)) return `${(v * 100).toFixed(1)}%`;
  if (key && ROUND_KEYS.has(key)) return `${Math.round(v)}`;
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(1)} 万`;
  return `${Math.round(v * 100) / 100}`;
}

/** 指标 key → 中文口径说明。展开后用户看到的是「这个数怎么来的」，不是变量名。 */
const METRIC_LABEL: Record<string, string> = {
  members: "成分股家数",
  up: "今日上涨家数",
  down: "今日下跌家数",
  upShare: "今日上涨占比",
  upShareAvg5: "过去 5 日上涨占比均值",
  limitUpShare: "涨停股占比",
  ret3: "近 3 个交易日涨幅 %",
  ret5: "近 5 个交易日涨幅 %",
  ret20: "近 20 个交易日涨幅 %",
  mkt3: "同期全 A 等权涨幅 %（3 日）",
  mkt5: "同期全 A 等权涨幅 %（5 日）",
  mkt20: "同期全 A 等权涨幅 %（20 日）",
  netAmountToday: "今日主力净流入（元）",
  netRatioToday: "今日主力净流入 ÷ 成交额",
  netFlow3: "近 3 日主力净流入合计（元）",
  netFlow5: "近 5 日主力净流入合计（元）",
  posFlowDays3: "近 3 日净流入天数",
  posFlowDays5: "近 5 日净流入天数",
  amountToday: "今日成交额（元）",
  amountRatio20: "今日成交额 ÷ 20 日均额",
  top2Concentration: "前两只贡献的净流入占比",
  top3Concentration: "前三只贡献的净流入占比",
  fundScore: "资金强度得分（0–100，内部）",
  fundPct: "资金强度在全行业中的分位",
  fundPctInSector: "资金强度在同行业中的分位",
  selfAnomalyPct: "相对自身近 60 日的分位",
  rankUp: "行业强弱排名 3 日内上升位数",
  coverage20: "20 日窗口里有足够历史的成分股数",
  changePct: "今日涨跌幅 %",
  sectorRet3: "所属行业近 3 日涨幅 %",
  sectorRet5: "所属行业近 5 日涨幅 %",
  excessOverSector3: "近 3 日相对所属行业超额（百分点）",
  avgAmount20: "过去 20 日平均成交额（元）",
  limitUpToday: "今日是否涨停",
  consecutiveLimitUps: "连续涨停天数",
};

function Card({ c }: { c: RadarCard }) {
  const n = c.narrative;
  const label = splitNameCode(c.name).name;
  const code = splitNameCode(c.name).code ?? c.ticker;
  const href = c.entityId ? `/entity/${c.entityId}` : null;
  const metricKeys = Object.keys(c.metrics).filter(
    (k) => k in METRIC_LABEL && c.metrics[k] !== null && c.metrics[k] !== undefined,
  );

  return (
    <li className="border-line bg-surface rounded-2xl border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <div className="flex items-baseline gap-2">
          {href ? (
            <Link
              href={href}
              className="text-ink hover:text-brand text-[15px] font-bold transition-colors"
            >
              {label}
            </Link>
          ) : (
            <span className="text-ink text-[15px] font-bold">{label}</span>
          )}
          {code ? (
            <span className="tabular text-muted text-xs">{code}</span>
          ) : null}
          {c.kind === "STOCK" && c.sector ? (
            <span className="text-muted text-[11px]">{c.sector}</span>
          ) : (
            <span className="text-muted text-[11px]">行业</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_CLS[c.signalType]}`}
            title={TYPE_HINT[c.signalType]}
          >
            {TYPE_LABEL[c.signalType]}
          </span>
          <span className="border-line text-muted rounded-full border px-2 py-0.5 text-[11px]">
            信号{c.strength === "STRONG" ? "强" : "中"}
          </span>
        </div>
      </div>

      {n ? (
        <>
          <Section label="为什么值得看" body={n.whyWatch} />
          <Section label="资金发生了什么" body={n.fundStory} />
          <Section label="行情处于什么阶段" body={n.stage} />
          <Section label="背后的催化" body={n.catalyst} />
          <Section label="还要验证什么" body={n.verify} />
          <Section label="主要风险" body={n.risk} />
        </>
      ) : (
        <p className="text-muted mt-2 text-[13px]">解释生成中。</p>
      )}

      {c.evidence.length > 0 ? (
        <div className="mt-3">
          <div className="text-muted text-[11px] font-semibold tracking-wide">
            证据（{c.evidence.length} 条 · 可点开原文）
          </div>
          <ul className="mt-1 space-y-1">
            {c.evidence.map((e) => (
              <li key={e.id} className="text-[12px] leading-snug">
                <Link
                  href={`/news/${e.id}`}
                  className="text-brand hover:underline"
                >
                  {e.title}
                </Link>
                <span className="text-muted ml-1.5">
                  {e.sourceName} ·{" "}
                  {new Date(e.publishedAt).toISOString().slice(5, 10)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 默认折叠：通俗结论在前，可复核的原始指标在后（§8） */}
      <details className="group mt-3">
        <summary className="text-muted hover:text-brand cursor-pointer text-[11px] font-medium select-none">
          展开数据（原始指标与计算口径）
        </summary>
        <div className="border-line/70 mt-2 overflow-x-auto rounded-xl border p-3">
          <div className="mb-2 text-[11px]">
            <span className="text-muted">入选原因：</span>
            <span className="text-ink">{c.reasons.join("；") || "—"}</span>
          </div>
          <table className="w-full text-[11px] whitespace-nowrap">
            <tbody className="divide-line/60 divide-y">
              {metricKeys.map((k) => (
                <tr key={k}>
                  <td className="text-muted py-1 pr-3">{METRIC_LABEL[k]}</td>
                  <td className="tabular text-ink py-1 text-right font-medium">
                    {fmt(c.metrics[k], k)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted mt-2 text-[10px] leading-relaxed">
            口径：涨幅按官方日涨跌幅连乘（已含除权除息处理）；全 A 为等权基准；
            主力资金为按成交单笔金额分档的估算数据，非交易所披露；
            分位为该指标在全部行业（或同行业个股）中的排名位置。
            生成于 {new Date(c.generatedAt).toISOString().slice(0, 16).replace("T", " ")}，
            失效于 {new Date(c.expiresAt).toISOString().slice(0, 10)}。
          </p>
        </div>
      </details>
    </li>
  );
}

export function OpportunityRadar({
  cards,
  risks,
  tradeDate,
}: {
  cards: RadarCard[];
  risks: { name: string; entityId: string | null; flags: string[] }[];
  tradeDate: Date | string | null;
}) {
  const d = tradeDate
    ? typeof tradeDate === "string"
      ? tradeDate.slice(0, 10)
      : tradeDate.toISOString().slice(0, 10)
    : null;

  return (
    <section id="opportunity-radar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="bg-brand h-5 w-1.5 rounded-full" aria-hidden />
          <h2 className="text-ink text-base font-bold">机会雷达</h2>
          {cards.length > 0 ? (
            <span className="bg-line/60 text-muted rounded-full px-1.5 text-[10px]">
              {cards.length}
            </span>
          ) : null}
        </div>
        <span className="text-muted text-[11px]">
          哪些变化可能仍处于早期，值得进一步研究{d ? ` · ${d}` : ""}
        </span>
      </div>

      {cards.length === 0 ? (
        <p className="border-line bg-surface text-muted mt-3 rounded-2xl border p-6 text-center text-sm">
          今日暂无高置信度的新机会。
          <span className="mt-1.5 block text-[11px]">
            宁可少给，也不降低标准凑数——没有信号本身也是一种信息。
          </span>
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {cards.map((c) => (
            <Card key={c.id} c={c} />
          ))}
        </ul>
      )}

      {risks.length > 0 ? (
        <div className="border-line bg-canvas mt-4 rounded-2xl border p-4">
          <div className="text-ink text-sm font-semibold">追高风险提示</div>
          <p className="text-muted mt-0.5 text-[11px]">
            这不是第四种机会，只是风险标签：以下标的已触发过热条件，因此<strong className="text-ink">没有</strong>进入上面的机会列表。
          </p>
          <ul className="mt-2 space-y-1">
            {risks.map((r) => (
              <li key={r.name} className="text-[12px] leading-snug">
                <span className="text-ink font-medium">
                  {r.entityId ? (
                    <Link
                      href={`/entity/${r.entityId}`}
                      className="hover:text-brand"
                    >
                      {splitNameCode(r.name).name}
                    </Link>
                  ) : (
                    splitNameCode(r.name).name
                  )}
                </span>
                <span className="text-muted ml-1.5">{r.flags.join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
