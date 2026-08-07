// OpenRouter 的流式调用（2026-07-29，为「问解牛」的 SSE 打字机加的）。
//
// 刻意开新文件，不动 `server/llm.ts` / `server/ai.ts`——那两份有一大票在用的调用方，
// 而流式的错误处理、中止语义都跟一次性拿完整字符串不一样，混在一起只会互相牵连。
//
// 密钥缺失时**抛错并写明原因，绝不裸 catch**：密钥缺失型故障是静默的（7-24 / 7-25 都栽在这）。
import { fetchLlm } from "~/lib/llm-http";

const DEFAULT_MODEL = "deepseek/deepseek-chat";

export function streamModel(): string {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}

export type StreamOpts = {
  maxTokens?: number;
  temperature?: number;
  /** 外部中止（合规护栏命中时立刻掐断上游，别再烧 token）。 */
  signal?: AbortSignal;
  /** 覆盖模型（问解牛走 GPT，见 `server/ask-model.ts`）。缺省用 `OPENROUTER_MODEL`。 */
  model?: string;
  /** 覆盖密钥（GPT 得用另一个 OpenRouter 账号）。缺省用 `OPENROUTER_API_KEY`。 */
  apiKey?: string;
};

/** 开流：只负责发请求 + 校验响应，把「换个候选重试」的判断留给调用方。 */
async function openStream(
  system: string,
  user: string,
  opts: StreamOpts,
): Promise<Response> {
  const key = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "缺 OPENROUTER_API_KEY —— 生产必须走 `scripts/start-prod.sh`（内含 secret exec）",
    );
  }
  const res = await fetchLlm(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://jieniu.swaylab.ai",
        "X-Title": "jieniu",
      },
      body: JSON.stringify({
        model: opts.model ?? streamModel(),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: opts.maxTokens ?? 850,
        temperature: opts.temperature ?? 0.4,
        stream: true,
      }),
      // 外部 signal（合规中止）由 fetchLlm 与超时叠加，不再自己兜 120s。
      signal: opts.signal,
    },
  );
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`openrouter ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

/**
 * 按候选链开流：**第一个 yield 之前**就把模型选定，所以退档对用户完全无感
 * （已经打出去的字退不回来，换模型只能发生在开口之前）。
 * 用于问解牛：主档是 GPT，打不开就退回默认档，而不是给用户一句「暂时无法作答」。
 */
export async function* llmChatStreamAny(
  system: string,
  user: string,
  candidates: { model: string; apiKey: string; label: string }[],
  opts: Omit<StreamOpts, "model" | "apiKey"> = {},
): AsyncGenerator<string, void, unknown> {
  if (candidates.length === 0) {
    throw new Error(
      "缺 OPENROUTER_API_KEY —— 生产必须走 `scripts/start-prod.sh`（内含 secret exec）",
    );
  }
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (const [i, c] of candidates.entries()) {
    try {
      res = await openStream(system, user, {
        ...opts,
        model: c.model,
        apiKey: c.apiKey,
      });
      if (i > 0) console.warn(`[ask] 降级到 ${c.label}（前一档开流失败）`);
      break;
    } catch (e) {
      lastErr = e;
      console.warn(
        `[ask] ${c.label} 开流失败：${e instanceof Error ? e.message : String(e)}`,
      );
      // 用户主动取消（关面板 / 切页）不该触发降级重试——那只是白烧一次 token。
      if (opts.signal?.aborted) throw e;
    }
  }
  if (!res) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  yield* readStream(res);
}

/**
 * 流式对话：逐块 yield 增量文本。
 * 只吐 `choices[0].delta.content`，其余字段（role/finish_reason 等）忽略。
 */
export async function* llmChatStream(
  system: string,
  user: string,
  opts: StreamOpts = {},
): AsyncGenerator<string, void, unknown> {
  const res = await openStream(system, user, opts);
  yield* readStream(res);
}

/** SSE 分帧 → 逐块 yield 增量文本（`openStream` 已保证 `res.body` 非空）。 */
async function* readStream(
  res: Response,
): AsyncGenerator<string, void, unknown> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 以空行分帧；最后一段可能不完整，留在 buffer 里等下一轮。
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "" || payload === "[DONE]") continue;
          let delta: string | undefined;
          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
            };
            delta = json.choices?.[0]?.delta?.content;
          } catch {
            // OpenRouter 偶尔插入注释行（": OPENROUTER PROCESSING"），不是 JSON，跳过即可。
            continue;
          }
          if (delta) yield delta;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
