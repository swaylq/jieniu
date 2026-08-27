/**
 * 新浪「资金流入趋势」历史解析（纯函数，无 IO）。
 *
 * 为什么是新浪而不是东财：东财 `push2` 对本节点是**间歇封锁**，2026-07-31 实测
 * clist 连打 5 次全部空响应，既有的 `EntitySignal(kind=flow)` 因此停在 7/30 14:17。
 * 而机会雷达要的恰恰是**历史**（60 日分位、3/5 日持续性、20 日均成交额），
 * 东财 clist 本身也只给"今天这一格"。新浪 `MoneyFlow.ssl_qsfx_zjlrqs` 一次请求
 * 回 60 个交易日的逐日主力净额，实测 0.33s / 17KB，是这一版唯一的历史资金来源。
 *
 * 字段口径（用 sh600519 / sz000812 逐字段对过腾讯快照，不是照文档想象）：
 *  · `changeratio` 是**小数**（0.0356 = 3.56%），不是百分数
 *  · `netamount`   主力净额（元）
 *  · `ratioamount` 主力净额 ÷ 成交额 —— 正是需求 §3 第 2 项，不用自己再除
 *  · `turnover`    换手率 ×100（实测 57.4943 ↔ 腾讯 0.57%）
 *  · 成交额没有直接字段，由 `netamount / ratioamount` 反推（与 K 线 close×volume
 *    交叉验证：茅台 7/30 得 97.1 亿 vs 97.9 亿，差异来自净额四舍五入，可接受）
 */

export type DailyFlow = {
  day: string; // YYYY-MM-DD
  close: number;
  changePct: number; // 百分数
  netAmount: number; // 主力净额（元），正=净流入
  netRatio: number; // 主力净额 / 成交额
  amount: number | null; // 成交额（元），反推不出时为 null
  turnoverRate: number | null; // 换手率 %
  /**
   * 超大单净额（元）。新浪 `r0_net`——**这个字段一直在响应里，2026-08-27 之前被丢弃了**。
   * 捡回来等于白拿 200 个交易日的超大单历史；大单 = `netAmount - netAmountXl`。
   * 交叉验证（600183 生益科技 8-27）：新浪 r0_net 25.66 亿 ↔ 东财 f66 超大单 25.04 亿，
   * 同一个概念、阈值略不同（东财超大单门槛是 ≥50 万股**或** 100 万元）。
   */
  netAmountXl: number | null;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 占比小于这个绝对值就不反推成交额——分母趋零会得到天文数字，宁可留空。 */
const MIN_RATIO = 1e-4;

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 新浪 `MoneyFlow.ssl_qsfx_zjlrqs` 响应 → 逐日资金流，**按日期升序**。结构不对返回 []。 */
export function parseSinaMoneyFlow(json: unknown): DailyFlow[] {
  if (!Array.isArray(json)) return [];
  const out: DailyFlow[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const day = typeof r.opendate === "string" ? r.opendate.slice(0, 10) : "";
    if (!DAY_RE.test(day)) continue;
    const close = num(r.trade);
    if (close === null || close <= 0) continue;
    const ratio = num(r.changeratio);
    const netAmount = num(r.netamount);
    const netRatio = num(r.ratioamount);
    if (netAmount === null || netRatio === null) continue;
    const turnover = num(r.turnover);
    out.push({
      day,
      close,
      changePct: ratio === null ? 0 : Math.round(ratio * 1e6) / 1e4,
      netAmount,
      netRatio,
      amount:
        Math.abs(netRatio) >= MIN_RATIO ? Math.abs(netAmount / netRatio) : null,
      turnoverRate: turnover === null ? null : turnover / 100,
      netAmountXl: num(r.r0_net),
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}
