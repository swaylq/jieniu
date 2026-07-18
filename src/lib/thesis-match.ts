import type { ThesisDimension } from "./thesis";
import { IMPORTANT_THRESHOLD } from "./importance";

/**
 * Gate 1（省 token 硬闸）：够"材料"的新闻才上 AI 分类——一手公告(PRIMARY，公司自己的披露，天然与逻辑相关)、
 * 或重磅(importance≥阈值)、或带事件类型。routine 媒体闲讯(MEDIA 低分无事件)直接挡下。
 */
export function isMaterialCandidate(n: {
  importance: number;
  eventType: string | null;
  tier: string;
}): boolean {
  return (
    n.tier === "PRIMARY" || n.importance >= IMPORTANT_THRESHOLD || !!n.eventType
  );
}

const SEP = /[\s、,，;；/·。：:（）()【】[\]「」+&]+/;

/** 从维度抽取关键词（key+watch 分词，去重、≥2 字），用于聚焦 AI 提示词。 */
export function dimensionKeywords(d: ThesisDimension): string[] {
  const toks = `${d.key} ${d.watch}`
    .split(SEP)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return [...new Set(toks)];
}

/** Gate 2（提示聚焦）：与新闻文本有关键词重叠的候选维度；为空表示无明显命中（此时可把全部维度交给 AI）。 */
export function candidateDimensions(
  dims: ThesisDimension[],
  text: string,
): ThesisDimension[] {
  return dims.filter((d) => dimensionKeywords(d).some((k) => text.includes(k)));
}

export type SignalOut = {
  dimensionKey: string;
  direction: "bull" | "bear" | "neutral";
  materiality: number;
  note: string;
};

function extractJsonArray(raw: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fence ? fence[1]! : raw;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("signals: 未找到 JSON 数组");
  }
  return body.slice(start, end + 1);
}

const DIRECTIONS = new Set(["bull", "bear", "neutral"]);

/** 解析 AI 输出的信号数组；只保留 dimensionKey ∈ validKeys、方向合法的条目，材料度夹到 0-100 整数。 */
export function parseSignals(raw: string, validKeys: string[]): SignalOut[] {
  const arr = JSON.parse(extractJsonArray(raw)) as unknown[];
  const keys = new Set(validKeys);
  const out: SignalOut[] = [];
  for (const item of arr) {
    const o = (item ?? {}) as Record<string, unknown>;
    const dimensionKey = typeof o.dimensionKey === "string" ? o.dimensionKey : "";
    const direction = typeof o.direction === "string" ? o.direction : "neutral";
    const note = typeof o.note === "string" ? o.note.trim() : "";
    const m = Number(o.materiality);
    if (!keys.has(dimensionKey) || !DIRECTIONS.has(direction) || !note) continue;
    out.push({
      dimensionKey,
      direction: direction as SignalOut["direction"],
      materiality: Math.max(0, Math.min(100, Math.round(Number.isFinite(m) ? m : 0))),
      note,
    });
  }
  return out;
}
