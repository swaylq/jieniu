"use client";

import Link from "next/link";

import { newsAskQuestion } from "~/lib/news-ask";
import { emitAsk } from "./ask-store";
import { AskIcon } from "./icons";

/**
 * 新闻行动按钮（P5-6）——把一条资讯接到「你的判断」：
 * 「问解牛」种入常驻问解牛面板（结合你持仓/逻辑解读这条；未登录→跳登录）、
 * 「更新我的逻辑」深链到相关标的的决策记录（复用已有 DecisionEditor）。
 * compact=列表卡用的轻量文字按钮；完整版（详情页）另附「更新我的逻辑」。
 */
export function NewsActions({
  title,
  entities,
  compact = false,
}: {
  title: string;
  entities?: { id: string; name: string }[];
  compact?: boolean;
}) {
  function onAsk() {
    if (!emitAsk(newsAskQuestion(title))) {
      const back =
        typeof window !== "undefined"
          ? encodeURIComponent(window.location.pathname)
          : "/";
      window.location.assign(`/login?returnTo=${back}`);
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={onAsk}
        className="inline-flex shrink-0 items-center gap-1 text-muted transition-colors hover:text-brand"
      >
        <AskIcon className="h-3.5 w-3.5" />
        问解牛
      </button>
    );
  }

  const pill =
    "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onAsk}
        className={`${pill} border-brand/40 bg-brand/10 text-brand hover:bg-brand/15`}
      >
        <AskIcon className="h-4 w-4" />
        问解牛这条
      </button>
      {entities?.slice(0, 3).map((e) => (
        <Link
          key={e.id}
          href={`/entity/${e.id}#decision`}
          className={`${pill} border-line bg-surface text-muted hover:border-brand hover:text-brand`}
        >
          更新我对 {e.name} 的逻辑
        </Link>
      ))}
    </div>
  );
}
