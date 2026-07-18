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
    ALI_REGION: z.string().default("cn-hangzhou"),
    MAIL_FROM: z.string().default("解牛 <noreply@mail.auramate.net>"),
    OPENROUTER_API_KEY: z.string().optional(),
    // 生产机在中国大陆网络：OpenRouter 的 anthropic/openai provider 会 403（provider ToS/地域封锁）。
    // 默认改用 DeepSeek——可访问、中文/A股财经能力强、成本低。可用 OPENROUTER_MODEL 环境变量覆盖。
    OPENROUTER_MODEL: z.string().default("deepseek/deepseek-chat"),
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
    ALI_REGION: process.env.ALI_REGION,
    MAIL_FROM: process.env.MAIL_FROM,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
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
