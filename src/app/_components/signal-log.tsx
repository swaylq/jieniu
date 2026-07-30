import Link from "next/link";
import { HoverPrefetchLink } from "./hover-prefetch-link";

import { dirLabel } from "~/lib/thesis-status";

/** 「近期触及逻辑的动态」一条：投资逻辑卡与「我的逻辑」卡共用（避免两处各写一遍、口径漂移）。 */
export type SignalLog = {
  dimensionKey: string;
  direction: string; // bull | bear | neutral
  materiality: number;
  note: string;
  newsTitle: string;
  /** 触发该信号的资讯 id；有则标题可点进原文（与事件时间线/逻辑异动一致）。 */
  newsId?: string | null;
};

/**
 * 单条监控日志：维度徽标 + 方向/材料度 + 说明 + 触发资讯标题。
 * 标题在有 newsId 时是链接（点进 /news 看触发这条信号的原文）——此前是纯文本、
 * 用户看到「是什么消息动了逻辑」却点不进去（QA loop run 9 维度 a）。
 */
export function SignalLogItem({ s }: { s: SignalLog }) {
  return (
    <li className="border-l-2 border-line pl-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <span className="rounded bg-line/60 px-1.5 py-0.5 font-medium text-muted">
          {s.dimensionKey}
        </span>
        <span className="text-muted">
          {dirLabel(s.direction)} · 材料度 {s.materiality}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink/85">{s.note}</p>
      {s.newsId ? (
        <HoverPrefetchLink
          href={`/news/${s.newsId}`}
          className="mt-0.5 line-clamp-1 block text-[11px] leading-relaxed text-muted transition-colors hover:text-brand"
        >
          {s.newsTitle}
        </HoverPrefetchLink>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted">{s.newsTitle}</p>
      )}
    </li>
  );
}
