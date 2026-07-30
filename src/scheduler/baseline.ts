// 基线式判据：拿**上一次成功运行**的同名指标做对照，只在「变坏了」时命中。相对导入、无 IO、可测。
//
// 为什么需要（2026-07-30 run3 实测）：`daily-maintenance` / `backfill-year` 有三条判据
// **结构性地每天必中**——
//   · `blank-companies`  阈值 >0，实际 81（全是退市壳，永远不会变成 0）
//   · `news-7d`          阈值 <85%，实际 49%（阈值是 802 家时代定的，扩容到 5500 家后永久不达标）
//   · `dupe-groups`      阈值 ≠0，实际 15（「标题完全相同」在真实数据里天然非零：
//                        5 家公司同日各发一份《投资者关系活动记录表》就是 5 条同名）
// JobRun 里有 alerts 的 3 次运行**全部命中**。每天必响的告警等于没有告警：真出事那天
// （`n24=0`，ingest 死了）那封信和昨天的噪音完全同形，人会照样划过去。
//
// 治法不是把阈值调松（那只是把线往下挪，明天照样漂到线下），而是换问题：
// **不问「现在是多少」，问「比上次坏了多少」**。结构性常数自动被抵消，
// 而真正的劣化——空白公司一夜多 50 家、覆盖率一天掉 10 个点——照样命中。
//
// 真·硬失败（`n24=0` 这类「零就是死了」）保留绝对阈值：它不需要对照，本身就是终局。

import type { Alert, Metrics } from "./types";

/** 基线判据：与上次同名指标比。`riseGt` = 涨超阈值即命中（越大越坏的指标）。 */
export type BaselineOp = "riseGt" | "dropGt";

export type BaselineCheckDef = {
  id: string;
  metric: string;
  op: BaselineOp;
  /**
   * 允许的变动幅度（绝对值，与指标同单位）。按**正常波动量级的 10 倍以上**取
   * ——阈值与被测行为同量级就等于回到每天必响（见 lessons「连续 N 次告警的阈值」那条）。
   */
  delta: number;
  message: string;
  /**
   * 没有基线可比时（首次运行 / 上次没打这个指标）是否命中。
   * 默认 false：**首跑不告警**。基线式判据的第一次运行天然无从判断，
   * 报出来只会是又一条噪音；而它下一轮就有基线了。
   */
  alertWhenNoBaseline?: boolean;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * 求值。`prev` 是上一次**成功**运行的 metrics（没有就传 null）。
 * 与绝对判据一样，「指标缺失」按命中处理——脚本改坏了不能表现为一片绿。
 */
export function evalBaselineChecks(
  defs: BaselineCheckDef[],
  metrics: Metrics,
  prev: Metrics | null,
): Alert[] {
  const out: Alert[] = [];
  for (const d of defs) {
    const cur = num(metrics[d.metric]);
    if (cur === null) {
      out.push({
        id: d.id,
        message: `判据「${d.id}」缺少指标 ${d.metric}——脚本没打 JSON_RESULT 或字段改名了`,
        value: (metrics[d.metric] as number | boolean | undefined) ?? null,
        threshold: d.delta,
      });
      continue;
    }
    const base = prev ? num(prev[d.metric]) : null;
    if (base === null) {
      if (d.alertWhenNoBaseline) {
        out.push({
          id: d.id,
          message: `判据「${d.id}」没有可比基线（首次运行或上次未产出该指标），当前 ${cur}`,
          value: cur,
          threshold: d.delta,
        });
      }
      continue;
    }
    const diff = d.op === "riseGt" ? cur - base : base - cur;
    if (diff > d.delta) {
      out.push({
        id: d.id,
        message: `${d.message}（上次 ${base} → 本次 ${cur}，${d.op === "riseGt" ? "增加" : "下降"} ${Math.round(diff * 100) / 100}，容许 ${d.delta}）`,
        value: cur,
        threshold: d.delta,
      });
    }
  }
  return out;
}
