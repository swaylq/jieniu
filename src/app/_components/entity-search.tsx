"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { entityTypeLabel } from "~/lib/format";
import { brandBtn, fieldCls } from "./section-head";

export function EntitySearch() {
  const [q, setQ] = useState("");
  const trimmed = q.trim();
  const router = useRouter();
  const query = api.entity.search.useQuery(
    { q: trimmed },
    { enabled: trimmed.length > 0 },
  );
  const results = query.data ?? [];

  // 自助加股（backlog #4）：搜不到覆盖标的时，用户可自建实体并加入自选。
  const addStock = api.entity.addStock.useMutation({
    onSuccess: (data) => {
      setQ("");
      router.push(`/entity/${data.companyId}`);
    },
  });
  const unauthorized = addStock.error?.data?.code === "UNAUTHORIZED";

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索板块 / 公司 / 股票代码…"
        className={fieldCls}
      />
      {trimmed.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
          {results.length === 0 ? (
            <li className="px-3 py-3">
              {query.isFetching ? (
                <span className="text-sm text-muted">搜索中…</span>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-sm text-muted">
                    没找到「{trimmed}」。解牛聚焦最热门板块的核心标的，可能暂未覆盖。
                  </p>
                  <button
                    type="button"
                    disabled={addStock.isPending}
                    onClick={() => addStock.mutate({ query: trimmed })}
                    className={`${brandBtn} w-full`}
                  >
                    {addStock.isPending
                      ? "正在添加…"
                      : `＋ 把「${trimmed}」加入我的自选`}
                  </button>
                  {addStock.error ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {unauthorized
                        ? "请先登录后再自助添加自选。"
                        : addStock.error.message}
                    </p>
                  ) : (
                    <p className="text-xs text-muted">
                      支持 6 位股票代码或公司全称；解牛会校验是真实 A
                      股后加入自选，并开始为你追踪其动态。
                    </p>
                  )}
                </div>
              )}
            </li>
          ) : (
            results.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/entity/${e.id}`}
                  className="flex items-center justify-between px-3 py-2.5 hover:bg-canvas"
                >
                  <span className="text-sm">
                    {e.name}
                    {e.ticker ? (
                      <span className="tabular ml-1 text-muted">
                        {e.ticker}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted">
                    {entityTypeLabel(e.type)}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
