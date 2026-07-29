// 输出脱敏。alert-mailer 会把真实用户邮箱打进 stdout，而这些输出会①落 JobRun.output
// （/admin/jobs 页公网可达）②送进 OpenRouter。两处都必须掩码后再走。
//
// 策略是「宁可多掩，不可漏」：发件地址也一起掩掉，不做白名单。

const EMAIL_RE =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function redact(text: string): string {
  return text.replace(
    EMAIL_RE,
    (_m, first: string, domain: string) => `${first}***${domain}`,
  );
}
