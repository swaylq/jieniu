/** 客户端安全的解读视角列表（勿在此 import 服务端代码）。与 prisma InterpretationKind 对应。 */
export const PERSONA_TABS = [
  { kind: "NEUTRAL", label: "中性解读", mono: "中" },
  { kind: "BUFFETT", label: "巴菲特", mono: "巴" },
  { kind: "MUNGER", label: "芒格", mono: "芒" },
  { kind: "LYNCH", label: "林奇", mono: "林" },
  { kind: "GRAHAM", label: "格雷厄姆", mono: "格" },
] as const;

export type InterpretKind = (typeof PERSONA_TABS)[number]["kind"];
