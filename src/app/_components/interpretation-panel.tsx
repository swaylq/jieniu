"use client";

import { useMemo, useState } from "react";

import { api } from "~/trpc/react";
import { type InterpretKind } from "~/lib/personas";
import {
  DEFAULT_INTERPRET_LENS,
  MASTER_LENS_INTRO,
  MASTER_LENS_TOGGLE_LABEL,
  isMasterLens,
} from "~/lib/interpretation-lens";
import { masterCompass } from "~/lib/master-compass";
import { InterpretationBody } from "./interpretation-body";
import { MasterCompass } from "./master-compass";

function BodyBlock({
  content,
  errored,
  authRequired,
}: {
  content: string | undefined;
  errored: boolean;
  authRequired?: boolean;
}) {
  if (content !== undefined) return <InterpretationBody md={content} />;
  if (authRequired)
    return (
      <p className="text-muted">
        登录后可生成 AI 解读；已生成过的解读无需登录即可查看。
      </p>
    );
  if (errored)
    return <p className="text-muted">解读生成失败，请稍后重试。</p>;
  return (
    <div>
      <div className="space-y-2">
        <div className="h-3 w-3/4 animate-pulse rounded bg-muted/25" />
        <div className="h-3 w-full animate-pulse rounded bg-muted/25" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-muted/25" />
      </div>
      <p className="mt-2 text-xs text-muted">解读生成中…（首次约数秒）</p>
    </div>
  );
}

/**
 * 通用 AI 解读面板（P5-12 大师视角降级）：
 * 默认视角=中性客观解读，展开即加载、直接展示；
 * 「大师视角」降级为 opt-in 的可选镜头，收在「换个大师视角看看（可选）」里，点开才显示罗盘。
 * thesis 相对解读由上方独立的「动没动你的逻辑」卡承担，优先级更高。
 */
export function InterpretationPanel({
  newsId,
  title,
  summary,
}: {
  newsId: string;
  title: string;
  summary?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showMasters, setShowMasters] = useState(false);
  const [open, setOpen] = useState<InterpretKind | null>(null);
  const [content, setContent] = useState<
    Partial<Record<InterpretKind, string>>
  >({});
  const [errored, setErrored] = useState<Set<InterpretKind>>(new Set());
  const [needLogin, setNeedLogin] = useState(false);
  const mutation = api.interpret.getOrCreate.useMutation();
  const track = api.analytics.track.useMutation();

  const compass = useMemo(
    () => masterCompass({ title, summary }),
    [title, summary],
  );

  async function load(kind: InterpretKind) {
    setOpen(kind);
    if (content[kind] === undefined && !errored.has(kind)) {
      track.mutate({ type: `interpret_${kind}`, newsId });
      try {
        const res = await mutation.mutateAsync({ newsId, kind });
        setContent((c) => ({ ...c, [kind]: res.content }));
      } catch (err) {
        const code =
          err && typeof err === "object" && "data" in err
            ? (err as { data?: { code?: string } }).data?.code
            : undefined;
        if (code === "UNAUTHORIZED") setNeedLogin(true);
        setErrored((s) => new Set(s).add(kind));
      }
    }
  }

  // 默认收起为紧凑「AI 解读 ▸」入口，压低列表密度；点击才展开并加载默认(中性)解读。
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          void load(DEFAULT_INTERPRET_LENS);
        }}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand hover:text-brand"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
        AI 解读
        <span className="text-[10px]" aria-hidden>
          ▸
        </span>
      </button>
    );
  }

  const masterActive = open && isMasterLens(open) ? open : null;
  const masterLoading =
    masterActive &&
    content[masterActive] === undefined &&
    !errored.has(masterActive)
      ? masterActive
      : null;

  return (
    <div className="mt-2 space-y-2">
      {/* 默认视角：中性客观解读，展开即显示 */}
      <div className="rounded-lg border border-line bg-canvas p-3 text-sm">
        <BodyBlock
          content={content[DEFAULT_INTERPRET_LENS]}
          errored={errored.has(DEFAULT_INTERPRET_LENS)}
          authRequired={needLogin}
        />
      </div>

      {/* 可选：大师视角镜头（opt-in，降级、非核心） */}
      {!showMasters ? (
        <button
          type="button"
          onClick={() => setShowMasters(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand hover:text-brand"
        >
          {MASTER_LENS_TOGGLE_LABEL}
          <span className="text-[10px]" aria-hidden>
            ▸
          </span>
        </button>
      ) : (
        <div className="rounded-lg border border-line/70 bg-surface p-3">
          <p className="mb-2 text-[10px] leading-relaxed text-muted">
            {MASTER_LENS_INTRO}
          </p>
          <MasterCompass
            compass={compass}
            active={masterActive}
            loading={masterLoading}
            onSelect={(k) => void load(k)}
          />
          {masterActive && (
            <div className="mt-2 rounded-lg border border-line bg-canvas p-3 text-sm">
              <BodyBlock
                content={content[masterActive]}
                errored={errored.has(masterActive)}
                authRequired={needLogin}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
