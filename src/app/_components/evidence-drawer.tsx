"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { impactBadgeClass } from "~/lib/logic-impact";
import { gradeLabel, type EvidenceGrade } from "~/lib/evidence";
import { sourceLine, type EvidenceDetail } from "~/lib/evidence-detail";

/**
 * 证据抽屉（张楚寒 2026-07-30）。
 *
 * 原话：「不建议点击后直接跳到外部新闻网站，会打断用户阅读。更适合点击整条『最新证据』，
 * 在右侧打开一个证据抽屉。」所以这里是**右侧滑出**，不是跳转、也不是居中弹窗——
 * 用户的阅读位置留在追踪器上，看完关掉就回到原处。
 *
 * 三段结构照他给的样例：客观事实 / 为什么能验证该命题 / 影响判断。
 * 「查看原文」是站内 `/news/<id>`，不外链。
 */
export function EvidenceDrawer({
  detail,
  onClose,
}: {
  detail: EvidenceDetail | null;
  onClose: () => void;
}) {
  // 必须挂到 body 上（portal），不能就地渲染。页面外层有 `.jn-page-in` 入场动画，
  // `animation: … both` 让末帧 `transform: none` 以**单位矩阵**留在计算样式里，
  // 而任何非 none 的 transform 都会给后代的 `position: fixed` 造一个 containing block——
  // 于是抽屉的 `inset-0` 量的是整页高度而不是视口：实测 aside 高 11197px，
  // 底部「查看原文」按钮被顶到折叠线以下，用户根本看不到。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // 抽屉开着时锁住背景滚动，否则滚轮会穿透到底下那页
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [detail, onClose]);

  if (!detail || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="关闭证据详情"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/40 backdrop-blur-sm"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface shadow-2xl">
        <header className="sticky top-0 z-10 border-b border-line bg-surface px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold tracking-wide text-muted">
                证据详情
              </p>
              <h2 className="mt-1 text-sm font-bold leading-relaxed text-ink">
                {detail.newsTitle}
              </h2>
              <p className="mt-1 text-[11px] text-muted">
                来源：{sourceLine(detail)}
                <span className="mx-1.5">·</span>
                <span className="text-brand">
                  {gradeLabel(detail.grade as EvidenceGrade)}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="-mr-1 shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              ×
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-5 px-5 py-4">
          <section>
            <h3 className="text-xs font-semibold text-ink">客观事实</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink/85">{detail.fact}</p>
          </section>

          {detail.why ? (
            <section>
              <h3 className="text-xs font-semibold text-ink">为什么能验证该命题</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink/85">{detail.why}</p>
            </section>
          ) : null}

          {/* 证据强度——张楚寒那条链的第 4 环。他的原话：
              「『已验证』最好至少需要一条能够直接支持命题的一级至三级证据。
                只有研报观点或者AI推断，最多标为『部分验证』。」
              把这条规则**当场讲给用户听**，比只丢一个徽章可信得多。 */}
          <section>
            <h3 className="text-xs font-semibold text-ink">证据强度</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={
                  detail.strength.hard
                    ? "rounded bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand"
                    : "rounded border border-line px-2 py-0.5 text-[11px] font-medium text-muted"
                }
              >
                {detail.strength.level} 级 · {detail.strength.levelLabel}
              </span>
              <span className="rounded border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
                {gradeLabel(detail.grade as EvidenceGrade)}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink/75">
              {detail.strength.verdict}
            </p>
          </section>

          <section>
            <h3 className="text-xs font-semibold text-ink">影响判断</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              这一条资讯对每个投资命题的影响。写「尚未验证」不是遗漏——是它证明不了那条。
            </p>
            <ul className="mt-2 divide-y divide-line/60 rounded-xl border border-line/70">
              {detail.impacts.map((im) => (
                <li
                  key={im.dimensionKey}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span
                    className={`text-xs ${im.touched ? "font-medium text-ink" : "text-muted"}`}
                  >
                    {im.dimensionKey}
                  </span>
                  {im.touched ? (
                    <span className={impactBadgeClass(im.tone)}>{im.label}</span>
                  ) : (
                    <span className="text-[11px] text-muted">{im.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {detail.newsId ? (
          <footer className="sticky bottom-0 border-t border-line bg-surface px-5 py-3">
            <Link
              href={`/news/${detail.newsId}`}
              className="block rounded-xl bg-brand/10 px-4 py-2.5 text-center text-xs font-semibold text-brand transition-colors hover:bg-brand/15"
            >
              查看原文与完整解读
            </Link>
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
