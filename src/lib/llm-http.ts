// OpenRouter HTTP 调用的公共壳（2026-08-07）：超时 + 可重试状态码的小退避重试。
//
// 为什么抽出来：三条调用路（`server/llm.ts` 的 llmChat、`server/ai.ts` 的 chatWith、
// `server/llm-stream.ts` 的 openStream）此前各自裸 fetch——`ai.ts` 那份**完全没有超时**，
// 可能无限挂起；`llm.ts` 有 120s 超时但三份都没有 429/5xx 重试，批量管线一遇上游限流
// 整轮失败（重试只能靠 scheduler 下一轮）。抽成一份，别让三条路继续漂。
//
// 语义刻意保持简单：**只重试瞬时状态码（429/500/502/503/504）**，401/403 是配置/账号问题，
// 重试无用；每次重试小退避 1s / 2s；最后一次响应无论 ok 与否都返回，调用方照常按 `!res.ok`
// 抛错。外部 signal（如问解牛的合规 abort）与超时用 `AbortSignal.any` 组合——缺一不可：
// 只留外部 signal 会丢掉超时兜底（ask/stream 曾因此绕过 120s 上限），只留超时会掐不掉上游。
import { setTimeout as sleep } from "node:timers/promises";

/** 单次调用的总超时。OpenRouter 慢模型（deepseek 长文）实测几十秒，120s 是安全上限。 */
export const LLM_TIMEOUT_MS = 120_000;

/** 可重试的瞬时状态码。 */
const RETRYABLE: Record<number, true> = {
  429: true,
  500: true,
  502: true,
  503: true,
  504: true,
};


/**
 * 带超时 + 小退避重试的 OpenRouter fetch。
 * @param retries 重试次数（默认 2 → 最多 3 次尝试）。调用方要求低延迟时可传 0。
 */
export async function fetchLlm(
  url: string,
  init: RequestInit,
  retries = 2,
): Promise<Response> {
  let res: Response | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // 每次重试都要重建 signal：AbortSignal.timeout 一旦触发就永久 abort，不能复用。
    // 外部 signal（合规中止）与超时叠加——任何一个触发都会掐断请求。
    const signals = [AbortSignal.timeout(LLM_TIMEOUT_MS)];
    if (init.signal) signals.push(init.signal);
    const signal = AbortSignal.any(signals);

    res = await fetch(url, { ...init, signal });
    if (!RETRYABLE[res.status]) return res;
    if (attempt < retries) {
      // 读掉响应体再退避，否则连接可能被复用成一个脏流。
      await res.text().catch(() => "");
      await sleep(1_000 * 2 ** attempt); // 1s、2s
    }
  }
  // 走到这里说明重试耗尽，返回最后一次响应，调用方按 !ok 抛错。
  return res!;
}
