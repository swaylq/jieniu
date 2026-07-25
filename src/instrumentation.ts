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

  if (missing.length === 0) {
    console.log("[boot] ✓ 密钥齐全：AI + 邮件可用");
    return;
  }

  console.error(
    `[boot] ✗ 缺少密钥 ${missing.map(([k]) => k).join(" / ")} —— ` +
      `以下功能会全部失败：${[...new Set(missing.map(([, use]) => use))].join("、")}。` +
      `生产必须用 scripts/start-prod.sh 启动（内含 secret exec 注入）。`,
  );
}
