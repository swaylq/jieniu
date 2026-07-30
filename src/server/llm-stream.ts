// OpenRouter 的流式调用（2026-07-29，为「问解牛」的 SSE 打字机加的）。
//
// 刻意开新文件，不动 `server/llm.ts` / `server/ai.ts`——那两份有一大票在用的调用方，
// 而流式的错误处理、中止语义都跟一次性拿完整字符串不一样，混在一起只会互相牵连。
//
// 密钥缺失时**抛错并写明原因，绝不裸 catch**：密钥缺失型故障是静默的（7-24 / 7-25 都栽在这）。

const DEFAULT_MODEL = "deepseek/deepseek-chat";

export function streamModel(): string {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}

export type StreamOpts = {
  maxTokens?: number;
  temperature?: number;
  /** 外部中止（合规护栏命中时立刻掐断上游，别再烧 token）。 */
  signal?: AbortSignal;
};

/**
 * 流式对话：逐块 yield 增量文本。
 * 只吐 `choices[0].delta.content`，其余字段（role/finish_reason 等）忽略。
 */
export async function* llmChatStream(
  system: string,
  user: string,
  opts: StreamOpts = {},
): AsyncGenerator<string, void, unknown> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "缺 OPENROUTER_API_KEY —— 生产必须走 `scripts/start-prod.sh`（内含 secret exec）",
    );
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://jieniu.swaylab.ai",
      "X-Title": "jieniu",
    },
    body: JSON.stringify({
      model: streamModel(),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: opts.maxTokens ?? 850,
      temperature: opts.temperature ?? 0.4,
      stream: true,
    }),
    signal: opts.signal ?? AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`openrouter ${res.status}: ${body.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
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
