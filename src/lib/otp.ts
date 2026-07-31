import { createHash, randomInt } from "node:crypto";

/** 6 位数字验证码（含前导零）。 */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** 只存验证码的哈希，不落明文。按 email 加盐避免不同邮箱同码撞 token 唯一键。 */
export function hashCode(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 邮箱验证码有效期：10 分钟（邮件正文里写的就是 10 分钟）。 */
export const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * 短信验证码有效期：**5 分钟**。不是拍脑袋——阿里云那个已过审模板的文案写死了
 * 「5分钟内有效」，模板改不了（要重新报备）。TTL 比文案长就是产品在说一套做一套：
 * 用户第 8 分钟试出来能用，下次就会以为 8 分钟都行。以文案为准。
 */
export const SMS_OTP_TTL_MS = 5 * 60 * 1000;

/**
 * 单个验证码允许的最大校验尝试次数。超过即作废该码，逼迫重新获取
 * （重新获取本身受 auth.requestOtp 限流），把 6 位码的在线爆破空间压到 5 次/码。
 */
export const MAX_OTP_ATTEMPTS = 5;
