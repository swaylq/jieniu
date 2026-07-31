/**
 * 机会卡的六段人话（需求 §8）——纯函数、无 IO、**无 AI**。
 *
 * 为什么先做确定性版本、AI 只做润色：
 *  ① 需求 §11 说大模型「不负责修改行情数据和数值评分」。这里每一句话的数字都直接
 *     来自 `metrics`，模型改不动。
 *  ② 密钥缺失 / 供应商地域封锁是**静默**故障（7-24、7-25 两次事故）。有了确定性底稿，
 *     AI 挂掉时页面照样说得清楚，而不是空着或写「暂时无法作答」。
 *  ③ 需求 §8 明确：前台不显示公式、Z-score、分位数。所以这里只出现金额、百分比、天数。
 */

import type { SectorDraft, StockDraft } from "./engine";

export type CardNarrative = {
  /** 为什么值得看 */
  whyWatch: string;
  /** 资金发生了什么 */
  fundStory: string;
  /** 行情处于什么阶段 */
  stage: string;
  /** 背后的催化 */
  catalyst: string;
  /** 还要验证什么 */
  verify: string;
  /** 主要风险 */
  risk: string;
};

/** 元 → 「+42.0 亿」。null 给「—」，不给 0（0 是个有意义的值）。 */
export function yi(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const n = v / 1e8;
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(1)} 亿`;
}

function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function ratioPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fundSentence(
  net3: number | null,
  posDays3: number,
  netRatio: number | null,
  anomaly: number | null,
): string {
  const parts = [`近 3 日主力资金合计 ${yi(net3)}，其中 ${posDays3} 天为净流入`];
  if (netRatio !== null)
    parts.push(`今日净流入约占成交额 ${ratioPct(Math.abs(netRatio))}`);
  if (anomaly !== null && anomaly >= 80)
    parts.push("这个力度在它自己近 60 个交易日里属于少见的水平");
  else if (anomaly !== null && anomaly <= 40)
    parts.push("不过这个力度在它自己近 60 个交易日里并不突出");
  return parts.join("；") + "。";
}

export function sectorNarrative(d: SectorDraft): CardNarrative {
  const m = d.metrics;
  const early = d.signalType === "EARLY";
  const excess3 =
    m.ret3 !== null && m.mkt3 !== null ? m.ret3 - m.mkt3 : null;
  const breadthJump =
    m.upShareAvg5 !== null ? (m.upShare - m.upShareAvg5) * 100 : null;

  const whyWatch = early
    ? `板块还没明显上涨，但资金在回流、上涨的公司在变多：今天 ${m.members} 家里有 ${m.up} 家在涨` +
      (breadthJump !== null && breadthJump > 0
        ? `，比过去 5 天的平均水平高出 ${breadthJump.toFixed(0)} 个百分点`
        : "") +
      "。"
    : `多数公司在同步上涨，资金也连着进来——这条线已经被市场认下来了：今天 ${m.members} 家里 ${m.up} 家在涨，近 5 日跑赢全 A ${pct(m.ret5 !== null && m.mkt5 !== null ? m.ret5 - m.mkt5 : null)}。`;

  const fundStory = fundSentence(
    m.netFlow3,
    m.posFlowDays3,
    m.netRatioToday,
    m.selfAnomalyPct,
  );

  const stage = early
    ? `目前属于早期改善：5 日涨幅 ${pct(m.ret5)}、20 日 ${pct(m.ret20)}，` +
      (excess3 !== null && excess3 > 0
        ? `近 3 日已经开始跑赢全 A ${pct(excess3)}，`
        : "") +
      "还没有走到拥挤的位置。"
    : `趋势已经形成：5 日涨幅 ${pct(m.ret5)}、20 日 ${pct(m.ret20)}，` +
      (m.amountRatio20 !== null
        ? `成交额是 20 日均量的 ${m.amountRatio20.toFixed(1)} 倍（放量但没到爆量）。`
        : "成交温和放大。");

  const top = d.catalyst.items[0];
  const catalyst = top
    ? `${top.title}（${top.sourceName}，${top.grade === "HIGH" ? "一手/硬数据" : top.grade === "MEDIUM" ? "行业数据或权威媒体" : "券商观点"}）` +
      (d.catalyst.items.length > 1
        ? `，另有 ${d.catalyst.items.length - 1} 条可查证据。`
        : "。")
    : (d.catalyst.emptyNote ?? "暂无明确催化，属于资金与价格异动，仍需验证。");

  const verify = early
    ? "接下来 2 个交易日要看：资金是否继续净流入，上涨是否扩散到更多公司，而不是只有几只龙头在撑。"
    : "接下来要看：成交额能否维持而不继续放大，上涨公司比例能否守住六成以上，资金是否还在净流入。";

  const riskBits = d.risks.length > 0 ? d.risks : [];
  if (m.top3Concentration !== null && m.top3Concentration > 0.5 && riskBits.length === 0)
    riskBits.push(`资金仍集中于少数龙头（前三只占 ${(m.top3Concentration * 100).toFixed(0)}%）`);
  const risk =
    riskBits.length > 0
      ? riskBits.join("；") + "。"
      : "暂未触发过热条件，但行业级信号本身不保证每只成分股都同步。";

  return { whyWatch, fundStory, stage, catalyst, verify, risk };
}

export function stockNarrative(d: StockDraft): CardNarrative {
  const m = d.metrics;
  const rs = d.signalType === "RELATIVE_STRENGTH";

  /**
   * 「跑赢行业 X 个百分点」必须同时给出**两个绝对数**（个股自己涨了多少、行业涨了多少）。
   * 实测强模型会把「跑赢行业 14.8 个百分点」改写成「反而涨了 14.8%」——数字没编，
   * 含义被换掉了。把两个绝对数都摆出来，模型就没有把差值当涨幅的空间。
   */
  const whyWatch = rs
    ? `所属的「${d.sector}」整体并不强：行业近 3 日 ${pct(m.sectorRet3)}，这家公司同期 ${pct(m.ret3)}，` +
      `相当于跑赢行业 ${pct(m.excessOverSector3)}（百分点），涨幅来自它自己的事。`
    : `它所在的「${d.sector}」正在走强（行业近 3 日 ${pct(m.sectorRet3)}），这家公司同期 ${pct(m.ret3)}，` +
      `资金与涨幅都在行业里靠前。`;

  const fundStory = fundSentence(
    m.netFlow3,
    m.posFlowDays3,
    m.netRatioToday,
    m.selfAnomalyPct,
  );

  const stage =
    m.ret5 === null
      ? "价格阶段数据不足。"
      : m.ret5 > 15
        ? `已经涨了不少：5 日 ${pct(m.ret5)}、20 日 ${pct(m.ret20)}，接近需要警惕追高的位置。`
        : m.ret5 > 5
          ? `刚开始走强：5 日 ${pct(m.ret5)}、20 日 ${pct(m.ret20)}，还没到拥挤区间。`
          : `尚未明显上涨：5 日 ${pct(m.ret5)}、20 日 ${pct(m.ret20)}，价格还在低位区间。`;

  const top = d.catalyst.items[0];
  const catalyst = top
    ? `${top.title}（${top.sourceName}，${top.grade === "HIGH" ? "一手/硬数据" : top.grade === "MEDIUM" ? "行业数据或权威媒体" : "券商观点"}）。`
    : (d.catalyst.emptyNote ?? "暂无明确催化，属于资金与价格异动，仍需验证。");

  const verify = top
    ? "要盯的是这条催化能不能落到数字上：后续订单/收入/毛利是否兑现，以及资金流入能否延续 2 个交易日以上。"
    : "在找到可查证的原因之前，这只股只能算资金与价格的异动，需要等公告或行业数据来确认。";

  const riskBits = [...d.risks];
  if (m.limitUpToday && !riskBits.some((r) => r.includes("涨停")))
    riskBits.push("今日已经涨停，不属于早期机会");
  if (m.avgAmount20 !== null && m.avgAmount20 < 3e8)
    riskBits.push("日均成交额偏小，冲击成本更高");
  const risk =
    riskBits.length > 0
      ? riskBits.join("；") + "。"
      : "所属行业本身偏弱，个股独立走强能否延续取决于催化是否持续兑现。";

  return { whyWatch, fundStory, stage, catalyst, verify, risk };
}
