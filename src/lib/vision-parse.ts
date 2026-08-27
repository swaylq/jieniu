// 持仓截图识别（2026-08-27，Blackie 提需求、楚寒拍板「这个好做」）的纯解析层。
// 视觉模型的原始输出 → 干净的结构化行。纯函数、无服务端依赖，单测直接打。
//
// 设计原则：模型输出一律不可信——数字可能带千分位/单位、代码可能混字母、
// 整段可能套 markdown 代码块。这里全部洗掉；洗不出来的字段置 null（看不清就不猜），
// 洗不出来的行丢弃（一行坏不拖死整页）。

import { z } from "zod";

/** 一行持仓：名称必有，代码/股数/成本价看不清就是 null。 */
export type VisionRow = {
  name: string;
  code: string | null;
  shares: number | null;
  cost: number | null;
};

/** 模型主动跳过的行（港股/美股/基金等），带回给用户看「为什么没导它」。 */
export type VisionSkipped = { name: string; reason: string };

export type VisionExtract = { rows: VisionRow[]; skipped: VisionSkipped[] };

/** 单张截图的持仓行数上限——券商 App 一屏十几行，30 是极宽松的闸，防模型发疯刷量。 */
export const MAX_VISION_ROWS = 30;

/**
 * 洗 OCR 数字："(1,680.50" / "1,680 元" / "100股" → 1680.5 / 100；
 * ""、"–"、"--"、null、NaN、负数 → null。负数在持仓里无意义（成本/股数非负）。
 */
export function cleanOcrNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[,，\s¥￥元股]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 洗代码：只留数字，恰好 6 位才算数（"SH600519" → "600519"；港股 5 位、
 * 转债代码混进来的一律 null，交给后续名称解析或 unsupported 判定）。
 */
export function cleanOcrCode(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const digits = String(v).replace(/\D/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** 模型爱给 JSON 套 ```json 围栏，剥掉再 parse。 */
export function stripCodeFence(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m?.[1]?.trim() ?? t;
}

const rowSchema = z.object({
  name: z.string().trim().min(1).max(30),
  code: z.preprocess(cleanOcrCode, z.string().nullable()),
  shares: z.preprocess(cleanOcrNumber, z.number().nullable()),
  cost: z.preprocess(cleanOcrNumber, z.number().nullable()),
});

const skippedSchema = z.object({
  name: z.string().trim().min(1).max(30),
  reason: z.string().trim().max(50).default("非 A 股"),
});

/** 逐行独立校验：坏行丢掉，好行留下——一行格式不对不该拖死整页识别。 */
function parseRows<S extends z.ZodTypeAny>(raw: unknown, schema: S, cap: number): z.output<S>[] {
  if (!Array.isArray(raw)) return [];
  const out: z.output<S>[] = [];
  for (const item of raw) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data as z.output<S>);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * 解析视觉模型输出 → 干净结构。任何一步不对返回 null（调用方换档/重试），绝不抛。
 * 同一实体重复出现的行去重（模型偶尔把合计行/重复行吐两遍）。
 */
export function parseVisionExtract(text: string): VisionExtract | null {
  if (!text.trim()) return null;
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;

  const rows = parseRows(obj.rows, rowSchema, MAX_VISION_ROWS);
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const key = r.code ?? r.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { rows: deduped, skipped: parseRows(obj.skipped, skippedSchema, 20) };
}
