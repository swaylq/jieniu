/**
 * 加自选的「理由标签」（2026-07-31 小哈 Sean 直报）。
 *
 * 原来加自选第二步是个自由文本框（onboarding-flow step2），用户原话：
 * 「你要我写理由，我基本上就劝退了 / 应该是要给点选项，让我选三四个选择题就好了」；
 * 张楚寒定调「打了理由也没用，不如全部用选项」。
 *
 * 这里给一组通用的 A 股投资理由标签，点选后拼成一句话写进 `UserThesis.reason`——
 * 下游（个股页「我的投资逻辑」卡、漂移复核、每日复盘）读的仍是同一个字符串字段，
 * 一行都不用改。自由文本降级成可选补充，默认收起。
 *
 * 标签是**通用**口径，与 AI 为每只股生成的 `dimensionKey`（「大客户」「产能 / 扩产」等 per-stock 维度）
 * 是两回事：那些逐股不同、没法做成固定选项。
 */

export type WatchReasonKey =
  | "growth"
  | "newbiz"
  | "cycle"
  | "policy"
  | "value"
  | "leader"
  | "moat"
  | "dividend";

export type WatchReason = {
  key: WatchReasonKey;
  /** 选项按钮上的字（4 字以内，手机上一行放得下两列）。 */
  label: string;
  /** 副标题：把行话翻成人话，降低「我是不是得很专业」的心理门槛。 */
  hint: string;
};

/** 选项词表。顺序即展示顺序，也是拼句时的排序依据（与点击先后无关，输出稳定）。 */
export const WATCH_REASONS: WatchReason[] = [
  { key: "growth", label: "业绩增长", hint: "营收/利润在提速" },
  { key: "newbiz", label: "新品新单", hint: "新产品或大订单落地" },
  { key: "cycle", label: "行业景气", hint: "所在行业在回暖" },
  { key: "policy", label: "政策受益", hint: "政策规划直接利好" },
  { key: "value", label: "估值便宜", hint: "现在的价格划算" },
  { key: "leader", label: "行业龙头", hint: "份额与地位领先" },
  { key: "moat", label: "技术壁垒", hint: "别人短期做不了" },
  { key: "dividend", label: "分红稳定", hint: "现金流好、分红大方" },
];

/** reason 字段上限——与 `userThesis.adopt` 的 `z.string().max(500)` 对齐，超了后端会直接拒。 */
export const REASON_MAX = 500;

const LABEL_BY_KEY = new Map(WATCH_REASONS.map((r) => [r.key, r.label]));

/**
 * 把「选中的标签 + 可选补充」拼成一句能读的理由。
 *
 * - 持仓说「看好」、观察说「关注」——同一句话在两种关系下语气不同。
 * - 排序按词表，不按点击顺序：同一组选择每次拼出的字符串一致，便于比对与去重。
 * - 未知 key 直接忽略（前端词表变更后，旧客户端传来的老 key 不该让整条落库失败）。
 * - 一个都没选且没写补充 → null（后端把 null 当「没填」，不是空字符串）。
 */
export function composeWatchReason({
  tags,
  status,
  extra,
}: {
  tags: readonly string[];
  status: "HOLDING" | "WATCH";
  extra?: string | null;
}): string | null {
  const seen = new Set(tags);
  const labels = WATCH_REASONS.filter((r) => seen.has(r.key)).map((r) => r.label);
  const tail = (extra ?? "").trim();

  if (labels.length === 0) return tail ? clamp(tail) : null;

  const head = `${status === "HOLDING" ? "看好" : "关注"}：${labels.join("、")}`;
  return clamp(tail ? `${head}。${tail}` : head);
}

/** 标签部分永远保得住：8 个标签拼满也就 40 字左右，被截掉的只会是自由补充。 */
function clamp(s: string): string {
  return s.length <= REASON_MAX ? s : s.slice(0, REASON_MAX);
}

/** 词表里有没有这个 key——前端做受控多选时用来挡住脏值。 */
export function isWatchReasonKey(k: string): k is WatchReasonKey {
  return LABEL_BY_KEY.has(k as WatchReasonKey);
}
