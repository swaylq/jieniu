"use client";

import { useState } from "react";

/**
 * 上传头像的 `<img>`，带一层兜底：图拉不到（文件被手工删了 / 磁盘换过）就退回渐变头像，
 * 而不是给用户一个破图图标。
 *
 * 用原生 `<img>` 不用 `next/image`：这张图服务端已经压成 256×256 WebP（10–25 KB），
 * 再过一次 Next 的优化管线纯属白烧 CPU，还要为一个动态路由配 `remotePatterns`。
 */
export function AvatarImage({
  src,
  className,
  fallback,
}: {
  src: string;
  className: string;
  fallback: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  if (broken) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      onError={() => setBroken(true)}
      className={`shrink-0 rounded-full object-cover shadow-[0_1px_3px_rgba(0,0,0,.35)] ring-1 ring-white/15 ${className}`}
    />
  );
}
