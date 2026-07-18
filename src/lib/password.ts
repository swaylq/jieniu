import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// 密码哈希：Node 内置 scrypt（无外部原生依赖）。存储格式 `scrypt$<saltHex>$<hashHex>`。
const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

/** 密码规则：8–128 位。 */
export function isValidPassword(plain: unknown): plain is string {
  return typeof plain === "string" && plain.length >= 8 && plain.length <= 128;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(plain, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts as [string, string, string];
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = (await scryptAsync(plain, salt, expected.length)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
