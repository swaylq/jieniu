"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

/**
 * 投资逻辑「生成中」占位——个股页发现还没有 thesis 时渲染它，并**自动触发一次生成**，
 * 完成后 `router.refresh()` 把真卡换上来。
 *
 * 为什么不在服务端直接生成：一次要 ~16s，挂在 SSR 上会把整页拖死（"外部接口拆到 Suspense" 的同一条教训）。
 * 为什么模块不能直接不渲染：那样「有的页有、有的页没有」，用户会以为这只股不支持——
 * 而真实原因只是还没轮到它。
 */
export function ThesisPending({ entityId, name }: { entityId: string; name: string }) {
  const router = useRouter();
  const fired = useRef(false);
  const [failed, setFailed] = useState(false);

  const ensure = api.entity.ensureThesis.useMutation({
    onSuccess: (r) => {
      if (r.result === "failed" || r.result === "skipped") setFailed(true);
      else router.refresh();
    },
    onError: () => setFailed(true),
  });

  useEffect(() => {
    // StrictMode 下 effect 会跑两次；ref 守住，别烧两次 token
    if (fired.current) return;
    fired.current = true;
    ensure.mutate({ id: entityId });
  }, [entityId, ensure]);

  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-5 w-1.5 rounded-full bg-brand" aria-hidden />
        <h2 className="text-base font-bold text-ink">投资逻辑</h2>
        {!failed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" aria-hidden />
            正在生成
          </span>
        ) : null}
      </div>

      {failed ? (
        <>
          <p className="text-sm leading-relaxed text-muted">
            {name} 的投资逻辑框架暂时没能生成。它会在后台补齐——稍后回来看，或
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                ensure.mutate({ id: entityId });
              }}
              className="mx-1 font-medium text-brand hover:underline"
            >
              重试一次
            </button>
            。
          </p>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-muted">
            正在为 {name} 生成投资逻辑监控框架——该盯哪些维度、什么算兑现、什么算恶化。
            大约十几秒，完成后会自动出现。
          </p>
          <div className="mt-4 space-y-2" aria-hidden>
            <div className="h-3 w-3/4 animate-pulse rounded bg-line/70" />
            <div className="h-3 w-full animate-pulse rounded bg-line/50" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-line/50" />
          </div>
        </>
      )}
    </section>
  );
}
