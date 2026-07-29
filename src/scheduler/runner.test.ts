import { describe, it, expect } from "vitest";
import { runStep } from "./runner";
import type { Step } from "./types";

const base = { cwd: process.cwd(), env: process.env };

describe("runStep", () => {
  it("正常退出：exitCode 0，输出收得到", async () => {
    const step: Step = { name: "ok", script: "src/scheduler/fixtures/ok.ts", args: [] };
    const r = await runStep(step, base);
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.output).toContain("JSON_RESULT");
  }, 60_000);

  it("非 0 退出：exitCode 与 stderr 都带回来", async () => {
    const step: Step = { name: "fail", script: "src/scheduler/fixtures/fail.ts", args: [] };
    const r = await runStep(step, base);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("故意失败");
  }, 60_000);

  it("超时：标 timedOut 并把进程杀掉", async () => {
    const step: Step = {
      name: "hang",
      script: "src/scheduler/fixtures/hang.ts",
      args: [],
      timeoutMs: 3_000,
    };
    const r = await runStep(step, base);
    expect(r.timedOut).toBe(true);
    expect(r.output).toContain("开始挂起");
  }, 60_000);

  it("缺密钥：不 spawn，直接标 skipped", async () => {
    const step: Step = {
      name: "needs-key",
      script: "src/scheduler/fixtures/ok.ts",
      args: [],
      requires: ["OPENROUTER_API_KEY"],
    };
    const r = await runStep(step, { cwd: process.cwd(), env: {} });
    expect(r.skipped).toBe("missing-secret");
    expect(r.output).toContain("OPENROUTER_API_KEY");
  }, 60_000);

  it("输出脱敏后才返回", async () => {
    const step: Step = { name: "ok", script: "src/scheduler/fixtures/ok.ts", args: [] };
    const r = await runStep(step, base);
    expect(r.output).not.toMatch(/[A-Za-z0-9._%+-]{2,}@/);
  }, 60_000);
});
