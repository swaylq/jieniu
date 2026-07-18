"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "~/trpc/react";
import { DISCLAIMER } from "~/lib/compliance";
import { InterpretationBody } from "./interpretation-body";
import { brandBtn, fieldCls } from "./section-head";
import { AskIcon, CloseIcon } from "./icons";
import { registerAskHandler } from "./ask-store";

/** 把答案里附加的免责块去掉，用作写回笔记的正文。 */
function stripDisclaimer(answer: string): string {
  const i = answer.indexOf(DISCLAIMER);
  if (i < 0) return answer.trim();
  return answer.slice(0, i).replace(/[\n\s—-]+$/, "").trim();
}

/**
 * 全局「问解牛」（P5-5）——常驻悬浮入口，打开后是一个**结合你持仓/投资逻辑**的私人投研问答，
 * 不是普通聊天：单轮问答 + 记忆归因 + 可执行「记为投资笔记」写回系统。
 * 仅登录用户可见（记忆护城河 + 省 token）；AI 只在你点「提问」时调用。
 */
export function AskJieniu() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [savedFor, setSavedFor] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ask = api.ask.answer.useMutation();
  const saveNote = api.ask.saveNote.useMutation();

  function runAsk(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    setSavedFor(new Set());
    ask.mutate({ question: trimmed });
  }

  // 供新闻卡等外部组件「问解牛这条」种入问题：打开面板 + 填入 + 直接提问（点击即显式意图）。
  useEffect(() => {
    return registerAskHandler((question) => {
      setOpen(true);
      setQ(question);
      runAsk(question);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function submit() {
    if (ask.isPending) return;
    runAsk(q);
  }

  const answer = ask.data?.answer;
  const grounding = ask.data?.grounding;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="问解牛"
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-colors hover:bg-brand-dark md:bottom-6 md:right-6"
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
          <div className="absolute inset-x-0 bottom-0 flex max-h-[86vh] flex-col rounded-t-2xl border border-line bg-canvas shadow-2xl md:inset-auto md:bottom-6 md:right-6 md:max-h-[80vh] md:w-[27rem] md:rounded-2xl">
            {/* 头部 */}
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-brand">
                  <AskIcon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-bold text-ink">问解牛</p>
                  <p className="text-[11px] text-muted">
                    结合你的持仓与投资逻辑 · 不构成投资建议
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            {/* 答案区 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {!answer && !ask.isPending && !ask.isError && (
                <div className="space-y-3 py-4 text-sm text-muted">
                  <p>问我关于你持仓、某条资讯、或某个板块的问题，我会结合你记录的投资逻辑来回答。例如：</p>
                  <ul className="space-y-1.5">
                    {[
                      "我的持仓这周逻辑有没有变化？",
                      "最近半导体的消息动没动我的逻辑？",
                      "帮我梳理下宁德时代我当初为什么看好。",
                    ].map((ex) => (
                      <li key={ex}>
                        <button
                          type="button"
                          onClick={() => {
                            setQ(ex);
                            inputRef.current?.focus();
                          }}
                          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-left text-xs text-ink transition-colors hover:border-brand hover:text-brand"
                        >
                          {ex}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {ask.isPending && (
                <div className="flex items-center gap-2 py-6 text-sm text-muted">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
                  解牛正在结合你的记忆思考…
                </div>
              )}

              {ask.isError && (
                <p className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-muted">
                  {ask.error.message || "暂时无法作答，请稍后再试。"}
                </p>
              )}

              {answer && (
                <div className="space-y-3">
                  <InterpretationBody md={answer} />

                  {grounding?.hasMemory &&
                    grounding.holdings.length > 0 && (
                      <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
                        <p className="mb-1.5 text-[11px] font-semibold text-muted">
                          结合了你的持仓 / 逻辑
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {grounding.holdings.slice(0, 6).map((h) => (
                            <span
                              key={h.entityId}
                              className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand"
                            >
                              {h.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* 写回：记为投资笔记 */}
                  {grounding && grounding.holdings.length > 0 && (
                    <div className="border-t border-line pt-3">
                      <p className="mb-2 text-[11px] font-semibold text-muted">
                        记为投资笔记（存进对应持仓的决策记录，仅观察）
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {grounding.holdings.slice(0, 4).map((h) => {
                          const done = savedFor.has(h.entityId);
                          return (
                            <button
                              key={h.entityId}
                              type="button"
                              disabled={done || saveNote.isPending}
                              onClick={() => {
                                const note = `问：${ask.variables?.question ?? ""}\n答：${stripDisclaimer(
                                  answer,
                                )}`.slice(0, 1000);
                                saveNote.mutate(
                                  { entityId: h.entityId, note },
                                  {
                                    onSuccess: () =>
                                      setSavedFor((prev) =>
                                        new Set(prev).add(h.entityId),
                                      ),
                                  },
                                );
                              }}
                              className={
                                done
                                  ? "rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
                                  : "rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
                              }
                            >
                              {done ? `✓ 已记入 ${h.name}` : `记入 ${h.name}`}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[11px] text-muted">
                        价格提醒需行情数据，暂未开放。
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 输入区 */}
            <div className="border-t border-line px-4 py-3">
              <textarea
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    (e.metaKey || e.ctrlKey) &&
                    e.key === "Enter"
                  ) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                maxLength={500}
                placeholder="问关于你持仓、某条资讯、或某个板块的问题…"
                className={`${fieldCls} resize-none`}
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-muted">
                  ⌘/Ctrl + Enter 发送 · AI 仅在你提问时调用
                </span>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!q.trim() || ask.isPending}
                  className={brandBtn}
                >
                  {ask.isPending ? "思考中…" : "提问"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
