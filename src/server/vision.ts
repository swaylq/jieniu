/**
 * 持仓截图识别（2026-08-27）：图片字节 → 视觉模型 → 干净的持仓行。
 *
 * 这是项目里**第一条多模态调用**——既有 `llm.ts` / `ai.ts` / `llm-stream.ts` 三条路
 * 的 messages 都是 system+user 双字符串签名，塞不进图片数组，所以照 llm-stream.ts
 * 「刻意开新文件不动旧调用方」的惯例独立成文。HTTP 壳复用 `fetchLlm`（超时/重试/abort）。
 *
 * 隐私铁律：券商截图里是真实资产数字——**不落盘、不进日志、不出现在任何错误消息里**。
 *  Buffer 进、base64 出、跑完即弃；调用方（portfolio router）同样不许把 input 打进日志。
 */

import { fetchLlm } from "~/lib/llm-http";
import { parseVisionExtract, type VisionExtract } from "~/lib/vision-parse";
import { visionCandidates } from "~/server/vision-model";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM =
  "你是券商 App 持仓截图的数据提取器。从图片里提取持仓表格，输出结构化数据。" +
  "只提取，不评论、不解释、不给任何投资建议。";

const INSTRUCTION = `提取这张券商持仓截图里的 A 股持仓，只输出一个 JSON 对象（不要 markdown 代码块）：
{"rows":[{"name":"股票名称","code":"6位代码","shares":持仓股数,"cost":成本价}],"skipped":[{"name":"名称","reason":"跳过原因"}]}

规则：
- rows 只收上海/深圳/北京的 A 股个股；港股、美股、基金、债券、逆回购、理财一律进 skipped
- code：图上能看清的 6 位数字代码；看不清或没显示就写 null，绝不猜
- shares：「持仓/持股数量」列的数字；cost：「成本价」列的数字；没有该列写 null
- 数字一律纯数值（不要千分位逗号、单位、货币符号）
- 现价/市值/盈亏/当日盈亏不要提取
- 图片不是持仓列表（K线、行情、聊天等）→ 输出 {"rows":[],"skipped":[]}
- 看不清的行宁可跳过也不编造`;

const RETRY_SUFFIX =
  "\n\n上次输出不是合法 JSON。这次只输出 JSON 对象本身，第一个字符是 {，最后一个字符是 }。";

export type VisionRun = {
  extract: VisionExtract;
  /** 实际命中的模型（日志/前端角标用）。 */
  model: string;
  /** true = 主档没打开、退到了兜底档（对应 [ask] 降级 的同款信号）。 */
  degraded: boolean;
};

/** 按魔数嗅 MIME（decodeImageDataUrl 已验过这三家，这里只翻译成名）。 */
function sniffImageMime(buf: Buffer): string {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF") return "image/webp";
  return "image/jpeg";
}

/** 取文本内容：OpenRouter 绝大多数模型返回字符串，个别返回 parts 数组，都接住。 */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p !== "object" || p === null) return "";
        const t = (p as { text?: unknown }).text;
        return typeof t === "string" ? t : "";
      })
      .join("");
  }
  return "";
}

/**
 * 识别一张持仓截图。成功返回结构化行；所有候选都失败则抛错（消息里只有模型名/状态码，
 * 绝不含图片内容）。
 *
 * 降级语义照抄 ask 链：**换档只发生在「这一档什么都没产出」之前**——HTTP 失败或输出
 * 无法解析才走下一档，同一档解析失败会先带着「只许输出 JSON」的追加指令重试一次。
 */
export async function extractHoldingsFromImage(image: Buffer): Promise<VisionRun> {
  const candidates = visionCandidates();
  if (candidates.length === 0) {
    throw new Error("缺 OPENROUTER_API_KEY（生产必须走 scripts/start-prod.sh）");
  }
  const dataUrl = `data:${sniffImageMime(image)};base64,${image.toString("base64")}`;

  let lastErr = "无可用候选";
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchLlm(
        OPENROUTER_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${c.apiKey}`,
            "HTTP-Referer": "https://jieniu.swaylab.ai",
            "X-Title": "jieniu",
          },
          body: JSON.stringify({
            model: c.model,
            temperature: 0,
            max_tokens: 2000,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM },
              {
                role: "user",
                content: [
                  { type: "text", text: attempt === 0 ? INSTRUCTION : INSTRUCTION + RETRY_SUFFIX },
                  { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
                ],
              },
            ],
          }),
        },
        1, // 用户在线等，429/5xx 只补一次，剩下的交给换档
      );
      if (!res.ok) {
        lastErr = `${c.model} HTTP ${res.status}`;
        await res.text().catch(() => ""); // 读掉响应体，别留脏连接
        break; // 换下一档
      }
      const j = (await res.json()) as {
        choices?: { message?: { content?: unknown } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = contentText(j.choices?.[0]?.message?.content);
      const extract = parseVisionExtract(text);
      if (extract) {
        // usage 只打数字，成本可追溯（全站此前没有 token 记录，从这开始）。
        console.log(
          `[vision] ${c.model} rows=${extract.rows.length} skipped=${extract.skipped.length} ` +
            `in=${j.usage?.prompt_tokens ?? "?"} out=${j.usage?.completion_tokens ?? "?"}`,
        );
        return { extract, model: c.model, degraded: i > 0 };
      }
      lastErr = `${c.model} 输出无法解析`;
    }
    if (i < candidates.length - 1) {
      console.warn(`[vision] 降级：${lastErr} → 试 ${candidates[i + 1]!.model}`);
    }
  }
  throw new Error(`截图识别失败：${lastErr}`);
}
