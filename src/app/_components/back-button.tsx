"use client";

import { useRouter } from "next/navigation";

/** 「← 返回」：优先回浏览器上一页；无历史（直达/新标签打开）时回首页。 */
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push("/");
        }
      }}
      className="text-sm text-muted transition-colors hover:text-brand"
    >
      ← 返回
    </button>
  );
}
