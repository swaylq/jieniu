// 单步执行：spawn 现有的 src/scripts/*.ts。
//
// 为什么 spawn 而不是 import 进来跑：那 46 个脚本每个都自带 `new PrismaClient()` 和
// 顶层 `main()`——import 会立刻执行并各开一个连接池。spawn 是零改动的精确复刻，
// 内存隔离；长回填被系统回收也只损失当前这片（脚本全幂等，下轮原样续）。

import { spawn } from "node:child_process";
import path from "node:path";
import { redact } from "./redact";
import type { Step } from "./types";

/** 输出只留尾部这么多字节——够看结论，又不会把库撑爆。 */
const OUTPUT_TAIL = 8 * 1024;
export const DEFAULT_TIMEOUT_MS = 45 * 60_000;
/** SIGTERM 之后再等这么久才 SIGKILL。 */
const KILL_GRACE_MS = 5_000;

export type StepResult = {
  name: string;
  exitCode: number | null;
  timedOut: boolean;
  /** 已脱敏的输出尾巴 */
  output: string;
  durationMs: number;
  skipped?: "missing-secret";
};

export type RunOpts = {
  cwd: string;
  env: Record<string, string | undefined>;
};

export async function runStep(step: Step, opts: RunOpts): Promise<StepResult> {
  const startedAt = Date.now();

  const missing = (step.requires ?? []).filter((k) => !opts.env[k]);
  if (missing.length > 0) {
    // 密钥缺失型故障是静默的（7-24 / 7-25 都栽在这）——绝不假装干过活。
    const msg =
      `[scheduler] 跳过「${step.name}」：缺密钥 ${missing.join(" / ")}。` +
      `生产必须用 scripts/start-scheduler.sh 启动（内含 secret exec 注入）。`;
    console.error(msg);
    return {
      name: step.name,
      exitCode: null,
      timedOut: false,
      output: msg,
      durationMs: Date.now() - startedAt,
      skipped: "missing-secret",
    };
  }

  const tsx = path.join(opts.cwd, "node_modules", ".bin", "tsx");
  const timeoutMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise<StepResult>((resolve) => {
    const child = spawn(tsx, [step.script, ...step.args], {
      cwd: opts.cwd,
      env: { ...opts.env, ...(step.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buf = "";
    let timedOut = false;
    let settled = false;

    const absorb = (chunk: Buffer) => {
      buf += chunk.toString();
      // 只留尾巴，边收边裁，长回填也不会把内存吃满。
      if (buf.length > OUTPUT_TAIL * 2) buf = buf.slice(-OUTPUT_TAIL);
    };
    child.stdout.on("data", absorb);
    child.stderr.on("data", absorb);

    let killTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }, timeoutMs);

    const done = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        name: step.name,
        exitCode,
        timedOut,
        output: redact(buf.slice(-OUTPUT_TAIL)),
        durationMs: Date.now() - startedAt,
      });
    };

    child.on("error", (e) => {
      console.error(`[scheduler] spawn「${step.name}」失败:`, e.message);
      buf += `\n[scheduler] spawn 失败: ${e.message}`;
      done(null);
    });
    child.on("close", (code) => done(code));
  });
}
