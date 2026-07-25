"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * 外壳固定后滚动发生在 #main-content 而非 window，Next 路由切换自带的滚动复位对它无效
 * （换页会停在上一页的滚动位置）。这里在每次 path / query 变化后把内容区滚回顶部，
 * 保留「换页从头看」的常规语义。分页走 `?page=`，所以 searchParams 也要监听。
 */
export function ScrollReset() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  }, [pathname, searchParams]);

  return null;
}
