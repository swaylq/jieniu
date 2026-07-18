// 轻量进程内固定窗口限流。用于挡：OTP 轰炸/爆破、埋点刷量、匿名触发付费 AI 生成。
// 单实例部署（Next.js 生产在 Caddy+rathole 后）→ 进程内计数足够；进程重启即清零，
// 故安全关键的验证码爆破另有 DB 侧 `VerificationToken.attempts` 计数做持久兜底（见 otp-verify）。

type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();

// 防止长时间运行后 Map 因不同 email/IP 键无限膨胀：超过阈值时清理已过期桶。
const MAX_KEYS = 10_000;

function sweep(now: number): void {
  for (const [k, b] of store) {
    if (now >= b.resetAt) store.delete(k);
  }
}

/**
 * 固定窗口限流。返回 true=放行、false=超限。
 * @param key      限流键（建议带维度前缀，如 `otp:send:email:foo@bar`）
 * @param limit    窗口内允许的最大次数
 * @param windowMs 窗口长度（毫秒）
 * @param now      当前时间戳（可注入，便于测试）
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const b = store.get(key);
  if (!b || now >= b.resetAt) {
    if (store.size >= MAX_KEYS) sweep(now);
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

/** 从反代转发头取客户端 IP（Caddy/rathole 走 x-forwarded-for）。取不到回退 "unknown"。 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() ?? "unknown";
}

/** 仅供测试：清空全部限流状态。 */
export function __resetRateLimitStore(): void {
  store.clear();
}
