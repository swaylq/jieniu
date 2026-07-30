import type { Schedule } from "./schedule";

export type SecretName = "OPENROUTER_API_KEY" | "ALI_KEY" | "ALI_SECRET";

export type Metrics = Record<string, number | boolean | string>;

import type { BaselineCheckDef } from "./baseline";

export type CheckDef = {
  /** 稳定 id，进 JobRun.alerts */
  id: string;
  /** metrics 里的字段名 */
  metric: string;
  op: "gt" | "gte" | "lt" | "lte" | "eq" | "ne";
  threshold: number | boolean;
  /** 命中时给人看的一句话 */
  message: string;
};

export type Step = {
  name: string;
  /** 相对仓库根，如 "src/scripts/ingest.ts" */
  script: string;
  args: string[];
  /** 该步额外的环境变量，逐字照抄今天 cron 命令行里的 */
  env?: Record<string, string>;
  /** 缺 key → 该步 skipped + 告警；不依赖它的后续步骤照跑 */
  requires?: SecretName[];
  timeoutMs?: number;
  /** 默认 false：前一步失败即中止后续 */
  runEvenIfPrevFailed?: boolean;
  checks?: CheckDef[];
  /**
   * 基线式判据：与**上一次成功运行**的同名指标比，只在变坏时命中。
   * 用于那些「绝对阈值会每天必响」的结构性指标（见 scheduler/baseline.ts 开头）。
   */
  baselineChecks?: BaselineCheckDef[];
};

export type JobDef = {
  key: string;
  title: string;
  schedule: Schedule;
  /** true = 与其他 heavy 任务全局互斥（并发跑长回填会被系统杀） */
  heavy: boolean;
  steps: Step[];
  /** 全绿也出 AI 小结（日级巡检） */
  alwaysNarrate?: boolean;
};

export type Alert = {
  id: string;
  message: string;
  value: number | boolean | string | null;
  threshold: number | boolean | null;
};

export type JobStatus = "running" | "ok" | "fail" | "timeout" | "skipped";
