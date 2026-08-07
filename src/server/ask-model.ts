/**
 * 「问解牛」专用模型（2026-08-05，sway：把问解牛换成 GPT）。
 *
 * **只换问解牛这一条链路**，其余 AI（解读 / thesis / drift / 画像 / 事件摘要 / 复盘）
 * 仍走 `OPENROUTER_MODEL` 那档便宜模型——问解牛是用户主动提问、一天几条，
 * 值得用贵的；批量管线不值得（分层原则见 `server/llm.ts` 的注释）。
 *
 * ## 一段值得留着的账号史（别再重踩）
 *
 * 换 GPT 那天的**旧** `OPENROUTER_API_KEY` 是这个形状：
 *
 * | provider | 旧 key | 新 key |
 * |---|---|---|
 * | `openai/*` `anthropic/*` `google/*` | 403 provider ToS | 200 |
 * | `deepseek/*` `meta-llama/*` | 200 | 200 |
 *
 * 挡的是**三家美国大厂**、不是 OpenAI 单家；而且**换请求 IP 没用**——同一把旧 key 从日本 VPS
 * 打 GPT 一样 403。限制绑在**账号的注册/结算地区**上、不看请求来源，所以「上代理/换机房」
 * 那条路是死的，只有换账号有用。当天 sway 换上新账号那把，三家全通，于是
 * `OPENROUTER_ASK_API_KEY` 就不再需要了（留着作后路，见下）。
 *
 * 教训：`403 provider ToS` 这句文案既不区分账号也不区分 provider，
 * **必须逐个 provider + 换个地点各打一遍**才说得清边界，不然会把「受限」当成「废了」。
 *
 * ## 为什么默认是 gpt-5.6-terra 而不是 gpt-5.2 / gpt-5.4 / gpt-5.4-mini
 *
 * 换代记录（2026-08-07，sway：换最新 GPT）：5.6 是当前最新系列，三档分别为
 * Luna（快而省）/ Terra（均衡）/ Sol（旗舰）。选 Terra：比 5.4-mini 只贵约 30%
 * （$1/$6 per M vs $0.75/$4.5），但推理质量跨两代；问解牛是产品核心、一天几条，
 * 值得。Luna 更便宜（约 1/6）但定位高吞吐轻任务，实测回答更简略。
 *
 * 关键约束是**出处编号必须是半角 `[1]`**：收尾核查 `invalidCitations()` 只认半角，
 * 全角 `〔1〕` 会让每条回答都被判「出处不存在」并挂上警告尾巴——gpt-5.2 就栽在这。
 * 5.6-terra / 5.6-luna 均已实测稳定输出半角 `[1]`（2026-08-07 真调用验证）。
 *
 * ## 兜底
 *
 * GPT 可能哪天又被同样地封掉（账号地区变更 / provider 政策变动都发生过）。
 * 所以 `askCandidates()` 返回的是**一条候选链**：GPT 打不开就自动退回默认档，
 * 用户看到的是「答得没那么好」而不是「解牛暂时无法作答」。
 * 密钥缺失型故障必须响，不能静默（7-24 / 7-25 两次事故都是这个形状）——
 * 退档时打 `[ask] 降级` 日志，`instrumentation.ts` 启动时也会把缺 key 喊出来。
 *
 * `OPENROUTER_ASK_API_KEY` 现在**不需要设**（主 key 就能打 GPT），但接口留着：
 * 万一将来又出现「主 key 打不了 GPT，得借另一个账号」的局面，设上它即可，代码不用动。
 */

/** 问解牛默认模型。可用 `OPENROUTER_ASK_MODEL` 覆盖（换 key 时多半也要换它）。 */
export const ASK_DEFAULT_MODEL = "openai/gpt-5.6-terra";

/** 全站默认档（`server/llm.ts` 的同名常量，此处刻意重复一份以免互相 import）。 */
const FALLBACK_MODEL = "deepseek/deepseek-chat";

export type LlmCandidate = {
  model: string;
  apiKey: string;
  /** 日志用的人话标签，绝不含密钥。 */
  label: string;
};

/**
 * 问解牛的候选链，按优先级排列。至少一个元素；一个都拼不出来时返回空数组，
 * 由调用方抛「缺 OPENROUTER_API_KEY」——那是配置事故，该响。
 */
export function askCandidates(): LlmCandidate[] {
  const mainKey = process.env.OPENROUTER_API_KEY;
  const askKey = process.env.OPENROUTER_ASK_API_KEY ?? mainKey;
  const askModel = process.env.OPENROUTER_ASK_MODEL ?? ASK_DEFAULT_MODEL;
  const fallbackModel = process.env.OPENROUTER_MODEL ?? FALLBACK_MODEL;

  const out: LlmCandidate[] = [];
  if (askKey) out.push({ model: askModel, apiKey: askKey, label: askModel });
  // 主模型和兜底模型是同一个（比如有人把 OPENROUTER_ASK_MODEL 设成了 deepseek）时
  // 不重复排一遍——重试同一个组合没有意义，只是白等一次超时。
  if (mainKey && !(out[0]?.model === fallbackModel && out[0]?.apiKey === mainKey)) {
    out.push({ model: fallbackModel, apiKey: mainKey, label: fallbackModel });
  }
  return out;
}

/** 启动自检 / 诊断用：当前问解牛跑在哪个模型上（不碰密钥值）。 */
export function askModelName(): string {
  return askCandidates()[0]?.model ?? "（未配置）";
}

/** 问解牛是否用了独立 key（启动日志里说清楚，免得以为换了其实没换）。 */
export function askUsesDedicatedKey(): boolean {
  const k = process.env.OPENROUTER_ASK_API_KEY;
  return !!k && k !== process.env.OPENROUTER_API_KEY;
}
