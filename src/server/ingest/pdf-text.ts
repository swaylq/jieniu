import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);

// 本机 poppler 的 pdftotext；可用 PDFTOTEXT 覆盖。缺失时 fetchPdfText 走兜底返回 null。
const PDFTOTEXT = process.env.PDFTOTEXT ?? "/opt/homebrew/bin/pdftotext";

/** 清理 pdftotext 输出：去 \r、压缩行内多余空白与连续空行。纯函数，便于单测。 */
export function cleanPdfText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 下载 PDF → pdftotext 提取正文；任何失败返回 null（兜底，不抛）。截断到 maxLen 字。 */
export async function fetchPdfText(
  url: string,
  maxLen = 4000,
): Promise<string | null> {
  const tmp = join(
    tmpdir(),
    `jn-${Date.now()}-${Math.floor(Math.random() * 1e9)}.pdf`,
  );
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (jieniu-ingest)" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) return null;
    await writeFile(tmp, buf);
    const { stdout } = await execFileP(
      PDFTOTEXT,
      ["-q", "-nopgbrk", "-enc", "UTF-8", tmp, "-"],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const text = cleanPdfText(stdout);
    return text.length > 20 ? text.slice(0, maxLen) : null;
  } catch {
    return null;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}
