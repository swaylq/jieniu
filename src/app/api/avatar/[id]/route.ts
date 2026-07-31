import { readAvatarImage } from "~/server/avatar-store";

/** 读磁盘，不能被预渲染成静态产物。 */
export const dynamic = "force-dynamic";

/**
 * 吐用户上传的头像。
 *
 * **不加鉴权**：头像不敏感（解牛没有社交流，除了本人也没人知道该拿哪个 id 去拉），
 * 而加了鉴权就等于放弃浏览器缓存——这张图挂在侧栏，每次换页都要出现。
 * `id` 由 `readAvatarImage` 内的 cuid 白名单挡住目录穿越。
 *
 * URL 带内容哈希 `?v=`，所以敢标 `immutable`：换了头像 URL 就变，旧 URL 再也没人引用。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const buf = await readAvatarImage(id);
  if (!buf) return new Response("未找到", { status: 404 });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
