import type { PrismaClient } from "../../generated/prisma";
import { hashCode, MAX_OTP_ATTEMPTS } from "~/lib/otp";

export type OtpResult = { ok: boolean; userId?: string };

/**
 * 校验验证码：命中且未过期 → 消费该邮箱全部码 + upsert User。
 * 被 tRPC auth.verifyOtp 与 NextAuth Credentials.authorize 共用。
 *
 * 安全要点（P1/P2 修复）：
 * - 整个「查码 → 计失败 / 消费 → 建号」放进单个事务，杜绝同一码被并发重复消费。
 * - 按 identifier 取当前码逐次比对：错码累加 `attempts`，达到 MAX_OTP_ATTEMPTS 即删码，
 *   使 6 位码的在线爆破被限制在每码 5 次（跨重启持久，是限流之外的硬兜底）。
 */
export async function verifyOtpCode(
  db: PrismaClient,
  emailRaw: string,
  code: string,
): Promise<OtpResult> {
  const email = emailRaw.toLowerCase();
  const wanted = hashCode(`${email}:${code}`);

  return db.$transaction(async (tx) => {
    // requestOtp 每次会先清空该邮箱旧码再建新码，故至多一条有效码。
    const row = await tx.verificationToken.findFirst({
      where: { identifier: email },
      orderBy: { expires: "desc" },
    });
    if (!row || row.expires.getTime() <= Date.now()) return { ok: false };

    if (row.token !== wanted) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_OTP_ATTEMPTS) {
        // 尝试用尽：作废该码，迫使重新获取（受限流）。
        await tx.verificationToken.deleteMany({ where: { identifier: email } });
      } else {
        await tx.verificationToken.update({
          where: { token: row.token },
          data: { attempts },
        });
      }
      return { ok: false };
    }

    // 命中：消费该邮箱全部码（单次有效）+ upsert User。
    await tx.verificationToken.deleteMany({ where: { identifier: email } });
    const user = await tx.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });
    return { ok: true, userId: user.id };
  });
}
