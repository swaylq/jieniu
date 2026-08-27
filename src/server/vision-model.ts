/**
 * 持仓截图识别专用视觉模型（2026-08-27，Blackie 提需求、楚寒拍板）。
 *
 * ## 实测记录（2026-08-27 真调用，合成持仓图逐个 provider 打）
 *
 * | model | 结果 |
 * |---|---|
 * | `openai/gpt-5.6-terra` | 200，824ms，读图正确 ✓ |
 * | `openai/gpt-5.6-luna` | 200，473ms ✓ |
 * | `google/gemini-2.5-flash` | 200，1256ms ✓ |
 * | `qwen/qwen3-vl-235b-a22b-instruct` | 200，466ms ✓ |
 * | `google/gemini-3-flash` | HTTP 400——**不存在的 id，别再用** |
 *
 * ## 为什么候选链是 terra → gemini → qwen
 *
 * - 兜底必须**跨 provider**：旧 key 时代 openai/anthropic/google 三家是一起 403 的
 *   （限制绑账号注册地区，账号史见 `server/ask-model.ts`），同 provider 换型号挡不住。
 * - `deepseek-chat` **没有视觉**，进不了这条链——别从 ask 链抄兜底习惯。
 * - qwen 是链上唯一非美国厂，且中文券商 UI 的 OCR 是它的主场，压阵合适。
 *
 * 主档可用 `OPENROUTER_VISION_MODEL` 覆盖（换 key/换账号时多半要换它，接口照 ask 链留的）。
 */

import type { LlmCandidate } from "./ask-model";

/** 截图识别默认模型。 */
export const VISION_DEFAULT_MODEL = "openai/gpt-5.6-terra";

/** 兜底两档（顺序即优先级）。 */
const VISION_FALLBACKS = [
  "google/gemini-2.5-flash",
  "qwen/qwen3-vl-235b-a22b-instruct",
] as const;

/**
 * 截图识别的候选链，按优先级排列。一个都拼不出来时返回空数组，
 * 由调用方抛「缺 OPENROUTER_API_KEY」——那是配置事故，该响（同 7-24 教训）。
 */
export function visionCandidates(): LlmCandidate[] {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return [];
  const primary = process.env.OPENROUTER_VISION_MODEL ?? VISION_DEFAULT_MODEL;
  const models = [primary, ...VISION_FALLBACKS.filter((m) => m !== primary)];
  return models.map((model) => ({ model, apiKey: key, label: model }));
}

/** 启动自检 / 诊断用：当前截图识别跑在哪个模型上（不碰密钥值）。 */
export function visionModelName(): string {
  return process.env.OPENROUTER_VISION_MODEL ?? VISION_DEFAULT_MODEL;
}
