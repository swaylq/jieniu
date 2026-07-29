// 指标提取与判据求值。
//
// 巡检脚本的中文报表是给人看的，别拿正则去爬（脆）。约定：脚本带 --json 时多打一行
// `JSON_RESULT {…}`，worker 只认这一行。
//
// 「指标缺失」按命中处理：脚本改坏了、字段改名了，都不能表现为「一片正确的绿」。

import type { Alert, CheckDef, Metrics } from "./types";

const MARKER = "JSON_RESULT ";

export function parseJsonResult(stdout: string): Metrics | null {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith(MARKER)) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(MARKER.length));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Metrics;
      }
      console.error(
        `[checks] JSON_RESULT 不是对象，忽略：${line.slice(0, 120)}`,
      );
      return null;
    } catch (e) {
      console.error(
        `[checks] JSON_RESULT 解析失败：${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
  return null;
}

function compare(
  op: CheckDef["op"],
  value: number | boolean,
  threshold: number | boolean,
): boolean {
  switch (op) {
    case "eq":
      return value === threshold;
    case "ne":
      return value !== threshold;
    case "gt":
      return Number(value) > Number(threshold);
    case "gte":
      return Number(value) >= Number(threshold);
    case "lt":
      return Number(value) < Number(threshold);
    case "lte":
      return Number(value) <= Number(threshold);
  }
}

export function evalChecks(defs: CheckDef[], metrics: Metrics): Alert[] {
  const alerts: Alert[] = [];
  for (const d of defs) {
    const raw = metrics[d.metric];
    if (raw === undefined || raw === null) {
      alerts.push({
        id: d.id,
        message: `判据「${d.id}」缺少指标 ${d.metric}——脚本没打 JSON_RESULT 或字段改名了`,
        value: null,
        threshold: d.threshold,
      });
      continue;
    }
    if (typeof raw === "string") {
      alerts.push({
        id: d.id,
        message: `判据「${d.id}」的指标 ${d.metric} 是字符串（${raw}），无法比较`,
        value: raw,
        threshold: d.threshold,
      });
      continue;
    }
    if (compare(d.op, raw, d.threshold)) {
      alerts.push({
        id: d.id,
        message: d.message,
        value: raw,
        threshold: d.threshold,
      });
    }
  }
  return alerts;
}
