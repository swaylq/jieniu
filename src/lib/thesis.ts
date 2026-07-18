export type ThesisDimension = {
  key: string; // 维度名，如「大客户 / 订单」
  watch: string; // 盯什么（具体指标 / 事件）
  bull: string; // 兑现 / 向好信号
  bear: string; // 恶化 / 风险信号
};

export type ThesisData = {
  summary: string; // 一句话投资逻辑
  dimensions: ThesisDimension[];
  bullCase: string;
  bearCase: string;
  catalysts: string[]; // 关键催化剂：什么发生会兑现逻辑（P4-2）
  invalidations: string[]; // 证伪条件：什么情况证明逻辑错了（P4-2，drift guard 的锚）
  keyLevels: string | null; // 关键价位观察（非买卖点）
};

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 把任意值规整为去空的字符串数组（用于 catalysts / invalidations 的解析与 DB Json 回读，空安全）。 */
export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(asString).filter((s) => s.length > 0);
}

/** 从 LLM 原始输出里取出 JSON 对象文本（容忍 ```json 围栏与前后噪声）。 */
function extractJsonBlock(raw: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fence ? fence[1]! : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("thesis: 未找到 JSON 对象");
  }
  return body.slice(start, end + 1);
}

/** 解析并校验 AI 生成的投资逻辑框架。缺少 summary 或维度则抛错。 */
export function parseThesis(raw: string): ThesisData {
  const obj = JSON.parse(extractJsonBlock(raw)) as Record<string, unknown>;
  const summary = asString(obj.summary);
  const rawDims = Array.isArray(obj.dimensions) ? obj.dimensions : [];
  const dimensions: ThesisDimension[] = rawDims
    .map((d) => {
      const o = (d ?? {}) as Record<string, unknown>;
      return {
        key: asString(o.key),
        watch: asString(o.watch),
        bull: asString(o.bull),
        bear: asString(o.bear),
      };
    })
    .filter((d) => d.key && d.watch);
  if (!summary || dimensions.length === 0) {
    throw new Error("thesis: 缺少 summary 或 dimensions");
  }
  return {
    summary,
    dimensions,
    bullCase: asString(obj.bullCase),
    bearCase: asString(obj.bearCase),
    catalysts: asStringArray(obj.catalysts),
    invalidations: asStringArray(obj.invalidations),
    keyLevels: asString(obj.keyLevels) || null,
  };
}
