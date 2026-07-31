import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { isUserIdLike } from "~/lib/avatar";

/**
 * 头像图片的落盘层：转码 → 原子写入 → 读取 / 删除。
 *
 * 为什么存文件而不是数据库：头像要被 `<img>` 直接拉，存库意味着每次 SSR 背几十 KB base64
 * 或者多一次查询；而存 `public/` 会污染仓库工作树（那是提交进 git 的目录）。
 * 落在 `var/avatars/`（已 gitignore），跟着机器走，备份时一并打包即可。
 */

/** 存盘边长。256 足够 2× 屏显示 8–48px 的头像，再大是浪费。 */
export const AVATAR_PIXELS = 256;

/** dataURL 载荷字符数上限。客户端裁好的 512×512 WebP 只有几十 KB，6 MB 是极宽松的闸。 */
const MAX_DATA_URL_CHARS = 6 * 1024 * 1024;

/** 放行的图片魔数。**不看 MIME 声明**——那是调用方随便写的字符串。 */
const MAGIC: readonly { name: string; test: (b: Buffer) => boolean }[] = [
  {
    name: "png",
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47,
  },
  {
    name: "jpeg",
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    name: "webp",
    test: (b) =>
      b.length > 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
];

/** 头像目录。测试与运维可用 `AVATAR_DIR` 挪走；默认落在工作目录下的 `var/avatars`。 */
function avatarDir(): string {
  return process.env.AVATAR_DIR ?? path.join(process.cwd(), "var", "avatars");
}

function avatarPath(userId: string): string {
  return path.join(avatarDir(), `${userId}.webp`);
}

/**
 * 解 dataURL → 图片字节。任何不对劲一律 `null`（调用方转成 400），绝不抛。
 *
 * 三道闸：长度 → 是不是 dataURL 且 base64 能解 → **魔数白名单**。
 * SVG 走不到这里（魔数不匹配），这是有意的：SVG 能带脚本，同源加载等于 XSS 面。
 */
export function decodeImageDataUrl(dataUrl: string): Buffer | null {
  if (typeof dataUrl !== "string" || !dataUrl) return null;
  if (dataUrl.length > MAX_DATA_URL_CHARS) return null;

  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!m?.[2]) return null;

  const payload = m[2].replace(/\s/g, "");
  let buf: Buffer;
  try {
    buf = Buffer.from(payload, "base64");
  } catch {
    return null;
  }
  // Buffer.from 对非法 base64 是「跳过坏字符」而不是抛，所以还要回头验一次长度对不对得上。
  if (buf.length === 0) return null;
  const expected = Math.floor((payload.replace(/=+$/, "").length * 3) / 4);
  if (Math.abs(buf.length - expected) > 2) return null;

  return MAGIC.some((f) => f.test(buf)) ? buf : null;
}

/**
 * 转码并落盘，返回内容版本号（URL 的 `?v=`，改了头像就换 URL，缓存永远命中且不会脏）。
 *
 * - `.rotate()` 必须在最前：吃掉 EXIF 方向标记，否则手机竖拍的照片会躺倒
 *   （这类图的像素其实是横的，靠 EXIF 告诉解码器转 90°）。
 * - 写 `.tmp` 再 `rename`：同一文件系统上 rename 是原子的，避免读到写了一半的文件。
 */
export async function saveAvatarImage(
  userId: string,
  input: Buffer,
): Promise<{ version: string }> {
  if (!isUserIdLike(userId)) throw new Error(`非法 userId: ${userId}`);

  // 转码放在落盘之前：畸形图在这里抛，磁盘上不会留下任何东西。
  const out = await sharp(input)
    .rotate()
    .resize(AVATAR_PIXELS, AVATAR_PIXELS, { fit: "cover", position: "centre" })
    .webp({ quality: 82 })
    .toBuffer();

  const dir = avatarDir();
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${userId}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, out);
    await rename(tmp, avatarPath(userId));
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }

  return { version: createHash("sha256").update(out).digest("hex").slice(0, 8) };
}

/** 读回字节；没存过 / 非法 id → null（路由据此返 404）。 */
export async function readAvatarImage(userId: string): Promise<Buffer | null> {
  if (!isUserIdLike(userId)) return null;
  try {
    return await readFile(avatarPath(userId));
  } catch {
    return null;
  }
}

/** 删除。不存在也算成功——调用方（恢复默认）只关心「删完之后没有了」。 */
export async function deleteAvatarImage(userId: string): Promise<void> {
  if (!isUserIdLike(userId)) return;
  await unlink(avatarPath(userId)).catch(() => undefined);
}
