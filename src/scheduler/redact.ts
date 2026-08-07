// 输出脱敏。alert-mailer 会把真实用户邮箱打进 stdout，而这些输出会①落 JobRun.output
// （/admin/jobs 页公网可达）②送进 OpenRouter。两处都必须掩码后再走。
//
// 策略是「宁可多掩，不可漏」：发件地址也一起掩掉，不做白名单。
// 除了邮箱，凡是长得像凭据的（DB 连接串密码 / sk-* / Bearer / 阿里云 Key）也一并掩掉——
// 运维脚本/调度输出会把它们打出来，同样会落 output 与进模型上下文。

const EMAIL_RE =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

// postgres://user:password@host → 只留协议+用户，掩掉密码。
const PG_URL_RE = /(postgres(?:ql)?:\/\/[^:@/\s]+):([^@\s]+)@/g;

// OpenAI/OpenRouter 形态密钥：sk-or-…（OpenRouter）与 sk-…（OpenAI）。
// sk- 至少 20 位才掩，避免误伤正文里随手写的「sk-」字样。
const SK_RE = /\bsk-or-[A-Za-z0-9._-]+|\bsk-[A-Za-z0-9._-]{20,}/g;

// Authorization: Bearer <token>——token 通常很长，≥6 位才掩，避免误伤「Bearer of」这类措辞。
const BEARER_RE = /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{6,}/g;

// 阿里云 AccessKey：ID 以 LTAI 开头（24 位字母数字）。
const ALI_ID_RE = /\bLTAI[A-Za-z0-9]{12,}\b/g;

// 阿里云相关 env 赋值：ALI*_KEY=值 → 掩掉值，留 key 名便于定位。
const ALI_ENV_RE = /\b(ALI[A-Z0-9_]*KEY[A-Z0-9_]*)\s*=\s*(?:"[^"]*"|\S+)/g;

export function redact(text: string): string {
  let out = text.replace(
    EMAIL_RE,
    (_m, first: string, domain: string) => `${first}***${domain}`,
  );
  out = out.replace(PG_URL_RE, (_m, prefix: string) => `${prefix}:***@`);
  out = out.replace(SK_RE, (m) =>
    m.startsWith("sk-or-") ? "sk-or-***" : "sk-***",
  );
  out = out.replace(BEARER_RE, "Bearer ***");
  out = out.replace(ALI_ID_RE, "LTAI***");
  out = out.replace(ALI_ENV_RE, (_m, name: string) => `${name}=***`);
  return out;
}
