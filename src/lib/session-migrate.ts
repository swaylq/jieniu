// 登录态无缝迁移：老域名(jieniu.swaylab.ai) → 新域名(jieniu.club)。
//
// 会话策略是 JWT（config.ts: session.strategy = "jwt"），两端同一把 AUTH_SECRET，
// 所以 JWT 本身在新域名上有效；唯一障碍是 cookie 只认自己域名（浏览器不会把
// swaylab.ai 的 cookie 发给 club）。这里用一次性迁移令牌绕过：
//   老域名签发一个 60s 短命令牌（还是 next-auth 的 JWT 格式、同一个 salt），
//   新域名 /api/auth/migrate 消费它，重签一个 30 天会话 cookie 落在 club 上。
export const SESSION_COOKIE = "__Secure-authjs.session-token";
export const NEW_ORIGIN = "https://jieniu.club";
export const OLD_DOMAINS = new Set(["jieniu.swaylab.ai", "www.jieniu.swaylab.ai"]);
export const MIGRATION_TTL = 60; // 秒，一次性令牌寿命
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 天，与 next-auth 默认一致

/** 只允许站内相对路径，防开放重定向。 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next;
}
