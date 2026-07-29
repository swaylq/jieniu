// 中文小结 —— 今天由 Claude 交互回合承担的那部分判断，改由 OpenRouter 承担。
//
// 复用 src/server/llm.ts：那份客户端就是为 tsx 场景写的（直读 process.env，不走 ~/env）。
// 模型固定 deepseek（anthropic / openai 在大陆 403）。
//
// 四条护栏：
//   ① AI 只解释、不裁决 —— status 与 alerts 全部由代码判定，喂给它的是已经判好的结论。
//   ② 必须喂环比 —— 「AI 写的都是正确的废话」根因在喂进去的数据，不在提示词。
//      巡检类小结取不到上一轮数字就不叫 AI，直接机械输出。
//   ③ AI 挂了不动任务状态 —— 单独 try/catch，失败退回机械摘要。绝不裸 catch。
//   ④ 喂进去的输出已在 runner 里脱敏。

import { llmChat } from "../server/llm";
import type { Alert, JobStatus, Metrics } from "./types";

export type NarrateInput = {
  title: string;
  status: JobStatus;
  alerts: Alert[];
  metrics: Metrics | null;
  prevMetrics: Metrics | null;
  /** 已脱敏的输出尾巴 */
  output: string;
};

export function shouldNarrate(x: {
  status: JobStatus;
  alerts: Alert[];
  alwaysNarrate: boolean;
}): boolean {
  if (x.status !== "ok" && x.status !== "running") return true;
  if (x.alerts.length > 0) return true;
  return x.alwaysNarrate;
}

const SYSTEM = [
  "你是解牛的运维助手。用户给你一次定时任务运行的**已判定结果**和原始输出，你只负责用中文解释。",
  "硬性要求：",
  "1. 成败已由代码判定，**不要改判**，也不要说「建议重跑看看是否正常」这类空话。",
  "2. 只讲输出里有据可查的事实；没有依据就说「输出里看不出原因」，不要编。",
  "3. 有环比数字时必须点出变化幅度；没有变化就直说稳定。",
  "4. 有异常时给出：哪一项、数字怎么变的、最可能的原因、建议的动作。",
  "5. 控制在 120 字以内，不要分点罗列，不要复述原始输出。",
].join("\n");

export function buildPrompt(input: NarrateInput): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`任务：${input.title}`);
  lines.push(`代码判定的状态：${input.status}`);

  if (input.alerts.length > 0) {
    lines.push("命中的判据：");
    for (const a of input.alerts) {
      lines.push(
        `  · ${a.message}（实际 ${String(a.value)}，阈值 ${String(a.threshold)}）`,
      );
    }
  } else {
    lines.push("命中的判据：无");
  }

  if (input.metrics) {
    lines.push("本轮指标：");
    for (const [k, v] of Object.entries(input.metrics)) {
      const prev = input.prevMetrics?.[k];
      lines.push(
        prev === undefined
          ? `  · ${k} = ${String(v)}`
          : `  · ${k}: ${String(prev)} → ${String(v)}`,
      );
    }
  }

  lines.push("原始输出（尾部，已脱敏）：");
  lines.push(input.output.slice(-3000));

  return { system: SYSTEM, user: lines.join("\n") };
}

/**
 * 返回 null 表示「这轮不该叫 AI」——调用方退回机械摘要。
 * 绝不因为 AI 失败而改变任务状态。
 */
export async function narrate(
  input: NarrateInput,
  opts: { alwaysNarrate: boolean },
): Promise<string | null> {
  if (
    !shouldNarrate({
      status: input.status,
      alerts: input.alerts,
      alwaysNarrate: opts.alwaysNarrate,
    })
  ) {
    return null;
  }
  // 护栏②：巡检类小结（状态 ok、只是例行出报告）没有环比就没料可写，别叫 AI。
  if (input.status === "ok" && input.alerts.length === 0 && !input.prevMetrics) {
    console.log(
      "[scheduler] 取不到上一轮指标，跳过 AI 小结（没有环比就没有增量信息）",
    );
    return null;
  }
  const { system, user } = buildPrompt(input);
  try {
    return await llmChat(system, user, { maxTokens: 400, temperature: 0.3 });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[scheduler] AI 小结失败:", reason);
    return `[AI 小结未生成] ${reason}`;
  }
}
