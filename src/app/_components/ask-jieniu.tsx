"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "~/trpc/react";
import { DISCLAIMER } from "~/lib/compliance";
import { splitSseFrames, parseSseFrame } from "~/lib/sse";
import { InterpretationBody } from "./interpretation-body";
import { fieldCls } from "./section-head";
import { AskIcon, CloseIcon } from "./icons";
import { registerAskHandler } from "./ask-store";

type Msg = { id: string; role: "user" | "assistant"; content: string };

const EXAMPLES = [
  "我的持仓这周逻辑有没有变化？",
  "最近半导体的消息动没动我的逻辑？",
  "帮我梳理下宁德时代我当初为什么看好。",
];

/** 把答案里附加的免责块去掉，用作写回笔记的正文。 */
function stripDisclaimer(answer: string): string {
  const i = answer.indexOf(DISCLAIMER);
  if (i < 0) return answer.trim();
  return answer
    .slice(0, i)
    .replace(/[\n\s—-]+$/, "")
    .trim();
}

/**
 * 全局「问解牛」——结合你持仓 / 投资逻辑的私人投研助手。
 *
 * 2026-07-29 按 sway 的三条反馈重做：
 * - **入口更显眼**：右下角那颗小钮加大加重（他选的 D 档：保留悬浮形态，只是别那么边缘）。
 * - **持续对话**：消息存 `AskMessage` 表，一位用户一条连续线，刷新/换设备都还在；
 *   进提示词的只有最近几轮（见 `lib/ask-history`），免得 token 滚雪球。
 * - **SSE + 打字机**：走 `/api/ask/stream`，增量到达即渲染——打字机效果就是流本身，
 *   不再额外做逐字动画。合规是**逐段护栏**（见那个 route handler 的注释），
 *   命中就把这条消息整段换成拦截提示。
 */
export function AskJieniu() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFor, setSavedFor] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const history = api.ask.history.useQuery(undefined, { enabled: open });
  const clearHistory = api.ask.clearHistory.useMutation();
  const saveNote = api.ask.saveNote.useMutation();
  const watchlist = api.watchlist.list.useQuery(undefined, { enabled: open });

  // 打开时把库里的历史灌进来（只在还没开始本地对话时，免得把正在流的内容冲掉）。
  useEffect(() => {
    if (!open || !history.data) return;
    setMsgs((prev) =>
      prev.length === 0
        ? history.data.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }))
        : prev,
    );
  }, [open, history.data]);

  // 新消息到达就滚到底——流式时每个增量都会触发，正好跟着字走。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, streaming]);

  const send = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text) return;
    setError(null);
    setSavedFor(new Set());
    setQ("");
    const stamp = String(Date.now());
    setMsgs((prev) => [
      ...prev,
      { id: `u-${stamp}`, role: "user", content: text },
      { id: `a-${stamp}`, role: "assistant", content: "" },
    ]);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const appendToLast = (chunk: string) =>
      setMsgs((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, content: m.content + chunk } : m,
        ),
      );
    const replaceLast = (content: string) =>
      setMsgs((prev) =>
        prev.map((m, i) => (i === prev.length - 1 ? { ...m, content } : m)),
      );

    try {
      const res = await fetch("/api/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(res.status === 401 ? "请先登录" : "暂时无法作答");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = splitSseFrames(buffer);
        buffer = rest;
        for (const raw of frames) {
          const { event, data } = parseSseFrame(raw);
          const payload = JSON.parse(data) as {
            text?: string;
            message?: string;
            disclaimer?: string;
          };
          if (event === "delta" && payload.text) appendToLast(payload.text);
          else if (event === "blocked") replaceLast(payload.text ?? "");
          else if (event === "done" && payload.disclaimer)
            appendToLast(payload.disclaimer);
          else if (event === "error")
            setError(payload.message ?? "暂时无法作答");
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setError(e instanceof Error ? e.message : "暂时无法作答");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // 落库发生在服务端，这里刷新一次让本地 id 与库里对齐（写笔记要真实内容，不要临时 id）。
      void history.refetch();
    }
    // history 的引用每次渲染都变，放进依赖会让 send 每次重建；这里只用它的 refetch。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 供新闻卡等外部组件「问解牛这条」种入问题。
  useEffect(() => {
    return registerAskHandler((question) => {
      setOpen(true);
      void send(question);
    });
  }, [send]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 关掉面板就掐断上游，别在背后继续烧 token。
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  const holdings = (watchlist.data ?? [])
    .map((w) => w.entity)
    .filter((e) => e.type === "COMPANY" || e.type === "STOCK")
    .slice(0, 4);
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="问解牛"
          /* 加大加重：原来是 px-4 py-3 的小钮，sway 说「太边缘了」。现在是 h-14 的胶囊，
             文字上到 15px、加一圈描边和更实的投影，扫一眼就能看见。 */
          className="bg-brand shadow-brand/40 ring-brand/20 hover:bg-brand-dark fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 inline-flex h-14 items-center gap-2.5 rounded-full px-5 text-[15px] font-semibold text-white shadow-xl ring-4 transition-colors md:right-6 md:bottom-6"
        >
          <AskIcon className="h-5 w-5" />
          问解牛
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="问解牛"
        >
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/40"
          />
          <div className="border-line bg-canvas absolute inset-x-0 bottom-0 flex max-h-[86vh] flex-col rounded-t-2xl border shadow-2xl md:inset-auto md:right-6 md:bottom-6 md:max-h-[80vh] md:w-[30rem] md:rounded-2xl">
            <div className="border-line flex items-center justify-between gap-2 border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="bg-brand/15 text-brand inline-flex h-7 w-7 items-center justify-center rounded-full">
                  <AskIcon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-ink text-sm font-bold">问解牛</p>
                  <p className="text-muted text-[11px]">
                    结合你的持仓与投资逻辑 · 不构成投资建议
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {msgs.length > 0 && (
                  <button
                    type="button"
                    disabled={streaming || clearHistory.isPending}
                    onClick={() => {
                      clearHistory.mutate(undefined, {
                        onSuccess: () => {
                          setMsgs([]);
                          void history.refetch();
                        },
                      });
                    }}
                    className="text-muted hover:text-ink rounded-md px-2 py-1 text-xs transition-colors disabled:opacity-50"
                  >
                    清空
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭"
                  className="text-muted hover:bg-surface hover:text-ink rounded-md p-1.5 transition-colors"
                >
                  <CloseIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
            >
              {msgs.length === 0 && !streaming && (
                <div className="text-muted space-y-3 py-4 text-sm">
                  <p>
                    问我关于你持仓、某条资讯、或某个板块的问题，我会结合你记录的投资逻辑来回答。对话会存下来，下次回来接着聊。例如：
                  </p>
                  <ul className="space-y-1.5">
                    {EXAMPLES.map((ex) => (
                      <li key={ex}>
                        <button
                          type="button"
                          onClick={() => void send(ex)}
                          className="border-line bg-surface text-ink hover:border-brand hover:text-brand rounded-lg border px-3 py-1.5 text-left text-xs transition-colors"
                        >
                          {ex}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {msgs.map((m, i) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <p className="bg-brand/10 text-ink max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap">
                      {m.content}
                    </p>
                  </div>
                ) : (
                  <div key={m.id} className="text-sm">
                    {m.content ? (
                      <InterpretationBody md={m.content} />
                    ) : i === msgs.length - 1 && streaming ? (
                      <span className="text-muted inline-flex items-center gap-2">
                        <span className="border-brand/30 border-t-brand h-3.5 w-3.5 animate-spin rounded-full border-2" />
                        正在结合你的记忆思考…
                      </span>
                    ) : null}
                  </div>
                ),
              )}

              {error && (
                <p className="border-line bg-surface text-muted rounded-lg border px-3 py-2.5 text-sm">
                  {error}
                </p>
              )}

              {/* 写回：把最后一条回答记为某持仓的投资笔记 */}
              {!streaming && lastAssistant?.content && holdings.length > 0 && (
                <div className="border-line border-t pt-3">
                  <p className="text-muted mb-2 text-[11px] font-semibold">
                    记为投资笔记（存进对应持仓的决策记录，仅观察）
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {holdings.map((h) => {
                      const done = savedFor.has(h.id);
                      return (
                        <button
                          key={h.id}
                          type="button"
                          disabled={done || saveNote.isPending}
                          onClick={() => {
                            const lastUser = [...msgs]
                              .reverse()
                              .find((m) => m.role === "user");
                            const note = `问：${lastUser?.content ?? ""}\n答：${stripDisclaimer(
                              lastAssistant.content,
                            )}`.slice(0, 1000);
                            saveNote.mutate(
                              { entityId: h.id, note },
                              {
                                onSuccess: () =>
                                  setSavedFor((prev) =>
                                    new Set(prev).add(h.id),
                                  ),
                              },
                            );
                          }}
                          className={
                            done
                              ? "border-brand/40 bg-brand/10 text-brand rounded-full border px-2.5 py-1 text-xs font-medium"
                              : "border-line bg-surface text-ink hover:border-brand hover:text-brand rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60"
                          }
                        >
                          {done ? `已记入 ${h.name}` : `记入 ${h.name}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="border-line border-t px-4 py-3">
              <textarea
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    if (!streaming) void send(q);
                  }
                }}
                rows={2}
                maxLength={500}
                placeholder="接着问…"
                className={`${fieldCls} resize-none`}
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted text-[11px]">
                  ⌘/Ctrl + Enter 发送 · AI 仅在你提问时调用
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (streaming) abortRef.current?.abort();
                    else void send(q);
                  }}
                  disabled={!streaming && !q.trim()}
                  className="bg-brand hover:bg-brand-dark rounded-full px-4 py-1.5 text-sm font-semibold text-white transition-colors disabled:opacity-40"
                >
                  {streaming ? "停止" : "发送"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
