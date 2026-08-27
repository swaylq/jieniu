/**
 * 启动自检（Next.js instrumentation hook，进程起来时跑一次）。
 *
 * 生产的密钥不在 `.env` 里，只在 `secret` store 里，靠 `scripts/start-prod.sh`
 * 的 `secret exec` 注入。若绕过脚本直接 `npm run start`，这些 key 会**静默**丢失：
 * 首页照样 200，但 AI 层（问解牛/解读/thesis/drift/画像/事件摘要）每次调用都 500，
 * 登录验证码也发不出去 —— 2026-07-25 就这么坏了一整天没人发现。
 *
 * 所以这里在启动时把缺失喊出来（只打 key 名，绝不打值）；
 * `scripts/start-prod.sh` 会 grep 这行来决定自己的退出码。
 */
export function register() {
  // 只在 Node runtime 跑（edge runtime 拿不到这些 server-only env）。
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const REQUIRED = [
    ["OPENROUTER_API_KEY", "AI 全线（问解牛 / 解读 / thesis / drift / 画像）"],
    ["ALI_KEY", "登录验证码邮件"],
    ["ALI_SECRET", "登录验证码邮件"],
  ] as const;

  const missing = REQUIRED.filter(([k]) => !process.env[k]);

  // 会话密钥强度自检：`.env` 里那份历史遗留值是一句自然语言（含空格、非 base64），
  // 熵太低不该签会话；正确来源是 secret store（由 scripts/start-prod.sh 注入）。
  // 只报形状判定，绝不打印值本身。
  const authSecret = process.env.AUTH_SECRET ?? "";
  const weakAuth =
    authSecret.length > 0 &&
    (/\s/.test(authSecret) || !/^[A-Za-z0-9+/=_-]+$/.test(authSecret));

  /**
   * 手机号登录（2026-07-31）。签名由 `scripts/start-prod.sh` 写死注入，不是密钥，
   * 但**缺了同样是静默的**：登录页会安静地少掉一档，没人会报错。所以一并打出来。
   */
  const smsSign = process.env.ALI_SMS_SIGN_NAME ?? "";
  const smsLine = smsSign
    ? `｜手机号登录 ✓（签名 ${smsSign}）`
    : "｜⚠ 手机号登录未开启（缺 ALI_SMS_SIGN_NAME，登录页只剩邮箱/密码）";

  /**
   * 问解牛跑在哪个模型上（2026-08-05 换 GPT 之后加的）。
   *
   * 它跟全站其余 AI 用**不同的模型**（GPT vs DeepSeek），而 `server/ask-model.ts` 的候选链
   * 在 GPT 打不开时会**静默**退回 DeepSeek：功能正常、答得差一档、没有任何报错。
   * 正是 7-24 / 7-25 那种「看不出坏了」的形状，所以启动就把打算用哪一档打出来
   * （真降级了另有 `[ask] 降级到 …` 一行）。
   */
  const askModel = process.env.OPENROUTER_ASK_MODEL ?? "openai/gpt-5.6-terra";
  const askKeyOwn =
    !!process.env.OPENROUTER_ASK_API_KEY &&
    process.env.OPENROUTER_ASK_API_KEY !== process.env.OPENROUTER_API_KEY;
  const askLine = `｜问解牛 → ${askModel}${askKeyOwn ? "（专用 key）" : ""}`;

  /**
   * 截图识别跑在哪个视觉模型上（2026-08-27）。与问解牛同理：候选链会**静默**降级
   * （terra → gemini → qwen，见 server/vision-model.ts），启动先把打算用哪档打出来
   * （真降级了另有 `[vision] 降级` 一行）。默认值刻意与 vision-model.ts 重复一份，免互相 import。
   */
  const visionModel = process.env.OPENROUTER_VISION_MODEL ?? "openai/gpt-5.6-terra";
  const visionLine = `｜截图识别 → ${visionModel}`;

  if (missing.length === 0) {
    console.log(
      `[boot] ✓ 密钥齐全：AI + 邮件可用${smsLine}${askLine}${visionLine}${weakAuth ? " ｜ ⚠ AUTH_SECRET 是弱值（含空格/非 base64），说明没走 scripts/start-prod.sh" : ""}`,
    );
    return;
  }

  console.error(
    `[boot] ✗ 缺少密钥 ${missing.map(([k]) => k).join(" / ")} —— ` +
      `以下功能会全部失败：${[...new Set(missing.map(([, use]) => use))].join("、")}。` +
      `生产必须用 scripts/start-prod.sh 启动（内含 secret exec 注入）。`,
  );
}
