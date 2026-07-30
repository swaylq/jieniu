// tsx 安全的 OpenRouter 客户端：直读 process.env，不走 ~/env（cron 用 tsx，别名不解析）。
// `src/server/ai.ts` 那份 chat() 服务 Next 运行时、走 `~/env`，两者刻意并存——
// 别为了「复用」把 ai.ts 改成相对导入，那会牵动一大票在用的调用方。
//
// 密钥缺失时抛错并写明原因，**绝不裸 catch**：密钥缺失型故障是静默的（7-24 / 7-25 都栽在这）。

const DEFAULT_MODEL = "deepseek/deepseek-chat";

/**
 * 模型分层（张楚寒 2026-07-30）：「成本上不用把所有内容都交给贵模型：行情统计用程序完成，
 * 便宜模型负责分类、聚类和打标，较强模型只负责最终 15—25 条卡片和总判断。
 * 内容增加两三倍，模型成本不需要同步增加两三倍。」
 *
 * 解牛的实现比这更省一档：**分类/聚类/打标全是纯规则**（`digest-pipeline.ts`，零 token、
 * 确定性、可单测），所以只剩两档——默认档（便宜模型，跑所有常规调用）与 `strong` 档
 * （只给复盘的最终成文与总判断）。`strong` 没配就退回默认档，不会因为漏配环境变量而静默变贵/变差。
 */
export type LlmTier = "default" | "strong";

export function llmModel(tier: LlmTier = "default"): string {
  if (tier === "strong") {
    return (
      process.env.OPENROUTER_MODEL_STRONG ??
      process.env.OPENROUTER_MODEL ??
      DEFAULT_MODEL
    );
  }
  return process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}

export async function llmChat(
  system: string,
  user: string,
  opts: { maxTokens?: number; temperature?: number; tier?: LlmTier } = {},
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "缺 OPENROUTER_API_KEY —— cron 必须用 `secret exec OPENROUTER_API_KEY -- …` 起",
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
      model: llmModel(opts.tier ?? "default"),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: opts.maxTokens ?? 1400,
      temperature: opts.temperature ?? 0.4,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`openrouter ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("openrouter 返回空响应");
  return content.trim();
}
