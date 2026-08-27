import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    ALI_KEY: z.string().optional(),
    ALI_SECRET: z.string().optional(),
    /**
     * 站点 canonical origin。**生产必须显式给**（`scripts/start-prod.sh` 已写死）：
     * 解牛跑在 xray(443) → Caddy(8443) → rathole → 本机 3838 后面，Auth.js 自己探测出来的
     * origin 是 `localhost:3838` —— 实测无论怎么传 Host / X-Forwarded-Host 都不改，
     * 于是「退出登录」跳到 https://localhost:3838/，用户掉线到一个打不开的地址。
     * Auth.js 直接读 `process.env.AUTH_URL`，这里声明只为可见；开发环境留空即按 localhost 走。
     */
    AUTH_URL: z.string().url().optional(),
    ALI_REGION: z.string().default("cn-hangzhou"),
    /**
     * 短信签名与模板（手机号登录）。签名**必须是阿里云已过审的那几个之一**，
     * 否则 SendSms 会返回 Code=isv.SMS_SIGNATURE_ILLEGAL。没配签名就等于关闭手机号登录
     * （`smsConfigured()` 返回 false，登录页只显示邮箱那一档）——不会静默发失败。
     */
    ALI_SMS_SIGN_NAME: z.string().optional(),
    /**
     * 短信模板。默认 SMS_501775398「尊敬的用户，您的注册验证码为：${code}，5分钟内有效」。
     * **不要照着 QuerySmsTemplateList 挑**：该账号列出 4 个模板全是 AUDIT_STATE_PASS，
     * 但实测只有这一个能被 SendSms 认（其余报「该账号下找不到对应模板」）——
     * 列表接口与发送接口在阿里云这边不是同一份账本。换模板前先真发一条验。
     */
    ALI_SMS_TEMPLATE_CODE: z.string().default("SMS_501775398"),
    MAIL_FROM: z.string().default("解牛 <noreply@mail.auramate.net>"),
    OPENROUTER_API_KEY: z.string().optional(),
    /**
     * 全站默认档（解读 / thesis / drift / 画像 / 事件摘要 / 复盘）。
     *
     * 仍然是 DeepSeek，但**这已经是成本选择、不再是被迫**：2026-08-05 换上的新 OpenRouter
     * 账号对 openai / anthropic / google 全部可用（旧账号对这三家一律 403 provider ToS）。
     * 批量管线跑的是分类/归纳这类活，DeepSeek 中文与 A 股语料够用、成本低一个量级，
     * 贵模型只留给问解牛与复盘成文（分层原则见 `server/llm.ts`）。
     */
    OPENROUTER_MODEL: z.string().default("deepseek/deepseek-chat"),
    /**
     * 「问解牛」专属模型 / 密钥（2026-08-05）。只换问解牛这一条链路，其余全站不动。
     * `_API_KEY` 现在不需要设（主 key 就能打 GPT），留作后路。
     * 缺省时自动退回上面那档，见 `src/server/ask-model.ts` 的完整说明。
     */
    OPENROUTER_ASK_MODEL: z.string().optional(),
    OPENROUTER_ASK_API_KEY: z.string().optional(),
    /**
     * 持仓截图识别专属视觉模型（2026-08-27）。缺省 openai/gpt-5.6-terra（实测视觉可用），
     * 候选链与兜底见 `src/server/vision-model.ts`——注意 deepseek 无视觉，兜底链里没有它。
     */
    OPENROUTER_VISION_MODEL: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ALI_KEY: process.env.ALI_KEY,
    ALI_SECRET: process.env.ALI_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    ALI_REGION: process.env.ALI_REGION,
    ALI_SMS_SIGN_NAME: process.env.ALI_SMS_SIGN_NAME,
    ALI_SMS_TEMPLATE_CODE: process.env.ALI_SMS_TEMPLATE_CODE,
    MAIL_FROM: process.env.MAIL_FROM,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    OPENROUTER_ASK_MODEL: process.env.OPENROUTER_ASK_MODEL,
    OPENROUTER_ASK_API_KEY: process.env.OPENROUTER_ASK_API_KEY,
    OPENROUTER_VISION_MODEL: process.env.OPENROUTER_VISION_MODEL,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
