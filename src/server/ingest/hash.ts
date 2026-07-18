import { createHash } from "node:crypto";

/** 稳定去重键：对 来源key + 标识 + 标题 做 sha256，取前 40 位十六进制。 */
export function newsHash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("")).digest("hex").slice(0, 40);
}
