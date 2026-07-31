"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { ENTITY_TYPE_LABEL } from "~/lib/format";
import { nameWithCode } from "~/lib/watch-label";
import { brandBtn, fieldCls } from "./section-head";
import { WATCH_REASONS, composeWatchReason } from "~/lib/watch-reasons";

/**
 * 加自选浮层（2026-07-31 小哈 Sean 直报两条）。
 *
 * ①「我找不到继续加自选的入口 / 入口不在顺手或者符合逻辑的地方」——
 *   加完第一只之后，手机上一个加自选入口都没有：侧栏那个 `+` 在 `hidden md:flex` 里，
 *   <768px 整个不渲染；自选页的「一键添加」CTA 只在 0 只时出现，加完就消失。
 *   所以这个浮层挂在**自选 tab 与首页自选卡的常驻按钮**上，就地打开、不跳去机会雷达。
 *
 * ②「加自选时你要我写理由，我基本上就劝退了 / 给点选项，选三四个选择题就好了」——
 *   理由改成 `WATCH_REASONS` 标签多选，零打字即可完成；自由文本降级成折叠的可选补充。
 *   标签一个都不选也能加（别把旧的强制项换成新的强制项）。
 *
 * 落库沿用既有契约，不新增接口：`portfolio.upsert` 建自选行 + `userThesis.adopt` 写理由。
 */

type Picked = { id: string; name: string; type: string; ticker: string | null };
type Status = "HOLDING" | "WATCH";

/** 实体类型标签。search 回来的 type 是裸 string，认不出就不显示，别为一个角标崩掉整行。 */
const typeLabel = (t: string): string =>
  (ENTITY_TYPE_LABEL as Record<string, string>)[t] ?? "";

/** 触发按钮。server component 里直接用它，浮层状态自持。 */
export function AddWatchButton({
  label = "+ 加自选",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
        }
      >
        {label}
      </button>
      <AddWatchSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function AddWatchSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const utils = api.useUtils();

  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  /** 选中那一刻它是否已在自选里——决定要不要碰 status（见 submit 的注释）。 */
  const [already, setAlready] = useState(false);
  const [status, setStatus] = useState<Status>("WATCH");
  const [tags, setTags] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  const [done, setDone] = useState<Picked | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 必须挂到 body 上（portal）：页面外层 `.jn-page-in` 的动画末帧 `transform: none`
  // 在计算样式里是单位矩阵，会给后代的 `position: fixed` 造 containing block——
  // 就地渲染的话 `inset-0` 量的是整页高度而不是视口（证据抽屉踩过，见其注释）。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const trimmed = q.trim();
  const results = api.entity.search.useQuery(
    { q: trimmed },
    { enabled: open && trimmed.length > 0, staleTime: 10_000 },
  );
  const watched = api.watchlist.list.useQuery(undefined, { enabled: open });
  const watchedIds = useMemo(
    () => new Set((watched.data ?? []).map((w) => w.entity.id)),
    [watched.data],
  );

  const upsert = api.portfolio.upsert.useMutation();
  const adopt = api.userThesis.adopt.useMutation();
  const track = api.analytics.track.useMutation();
  const addStock = api.entity.addStock.useMutation();
  const busy =
    upsert.isPending || adopt.isPending || addStock.isPending;

  function reset() {
    setQ("");
    setPicked(null);
    setAlready(false);
    setStatus("WATCH");
    setTags([]);
    setExtra("");
    setShowExtra(false);
    setDone(null);
    setErr(null);
  }

  function close() {
    reset();
    onClose();
  }

  function pick(e: Picked) {
    setPicked(e);
    setAlready(watchedIds.has(e.id));
    setErr(null);
  }

  async function selfAdd() {
    setErr(null);
    try {
      const r = await addStock.mutateAsync({ query: trimmed });
      // addStock 自己就把公司实体幂等写进了 watchlist，所以这里当「刚建的新行」处理：
      // 新行的字段全是 schema 默认值，后面 upsert 覆盖它是安全的。
      pick({ id: r.companyId, name: r.name, type: "COMPANY", ticker: r.ticker });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "添加失败，稍后再试。");
    }
  }

  async function submit() {
    if (!picked) return;
    setErr(null);
    const reason = composeWatchReason({ tags, status, extra });
    try {
      // 只有「本来不在自选里」才写 status——`portfolio.upsert` 的 update 分支会把
      // 没传的 costBasis/shares/weight/targetWeight/note 一律置 null，
      // 对老自选再点一次等于清掉用户手录的成本价与备注。
      if (!already) {
        await upsert.mutateAsync({ entityId: picked.id, status });
      }
      try {
        await adopt.mutateAsync({ entityId: picked.id, reason });
      } catch {
        // 该标的暂无 AI 基础框架，无法采纳逻辑；自选本身已经加成功，不算失败。
      }
      track.mutate({ type: "follow", entityId: picked.id });
      void utils.watchlist.list.invalidate();
      void utils.watchlist.isFollowing.invalidate();
      void utils.portfolio.list.invalidate();
      void utils.feed.myFeed.invalidate();
      router.refresh();
      setDone(picked);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加入失败，稍后再试。");
    }
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="加自选"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={close}
        className="fixed inset-0 cursor-default bg-black/40 backdrop-blur-sm"
      />
      <div className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-bold text-ink">
            {done ? "已加入自选" : picked ? "告诉解牛你和它的关系" : "加自选"}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="-mr-1 ml-auto shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {done ? (
            <DoneStep
              picked={done}
              onMore={reset}
              onGo={() => {
                close();
                router.push(`/entity/${done.id}`);
              }}
            />
          ) : picked ? (
            <DetailStep
              picked={picked}
              already={already}
              status={status}
              setStatus={setStatus}
              tags={tags}
              setTags={setTags}
              extra={extra}
              setExtra={setExtra}
              showExtra={showExtra}
              setShowExtra={setShowExtra}
              busy={busy}
              err={err}
              onBack={() => {
                setPicked(null);
                setErr(null);
              }}
              onSubmit={() => void submit()}
              onGo={() => {
                close();
                router.push(`/entity/${picked.id}`);
              }}
            />
          ) : (
            <SearchStep
              q={q}
              setQ={setQ}
              trimmed={trimmed}
              fetching={results.isFetching}
              results={results.data ?? []}
              watchedIds={watchedIds}
              onPick={pick}
              onSelfAdd={() => void selfAdd()}
              adding={addStock.isPending}
              err={err}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── 步骤组件一律定义在模块作用域 ─────────────────────────────────────────
   写在父组件函数体内会让每次渲染都产生新的函数对象 → React 按 `===` 比对
   元素 type 不等 → 卸载整棵子树重建 → 受控输入每敲一个字失焦一次
   （holding-editor / price-alert-card 踩过，见 evolution/lessons.md）。 */

function SearchStep({
  q,
  setQ,
  trimmed,
  fetching,
  results,
  watchedIds,
  onPick,
  onSelfAdd,
  adding,
  err,
}: {
  q: string;
  setQ: (v: string) => void;
  trimmed: string;
  fetching: boolean;
  results: Picked[];
  watchedIds: Set<string>;
  onPick: (e: Picked) => void;
  onSelfAdd: () => void;
  adding: boolean;
  err: string | null;
}) {
  return (
    <div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜股票名 / 代码，如 兆易创新 / 603986"
        className={fieldCls}
      />

      {!trimmed ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          加进来之后，解牛只在触及这只票投资逻辑的实质变化时才提醒你，其余静音。
        </p>
      ) : null}

      <div className="mt-3 space-y-1.5">
        {trimmed && fetching && results.length === 0 ? (
          <p className="text-sm text-muted">搜索中…</p>
        ) : null}

        {results.map((e) => {
          const has = watchedIds.has(e.id);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onPick(e)}
              className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-brand"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {nameWithCode(e.name, e.ticker)}
              </span>
              {has ? (
                <span className="shrink-0 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
                  已在自选
                </span>
              ) : null}
              <span className="shrink-0 text-[11px] text-muted">
                {typeLabel(e.type)}
              </span>
            </button>
          );
        })}

        {trimmed && !fetching && results.length === 0 ? (
          <div className="space-y-2.5 rounded-lg border border-line bg-canvas p-3">
            <p className="text-sm text-muted">
              没找到「{trimmed}」。换个名字或股票代码试试，或直接加进来。
            </p>
            <button
              type="button"
              disabled={adding}
              onClick={onSelfAdd}
              className={`${brandBtn} w-full`}
            >
              {adding ? "正在添加…" : `＋ 把「${trimmed}」加入我的自选`}
            </button>
            <p className="text-xs text-muted">
              支持 6 位股票代码或公司全称；解牛会校验是真实 A 股后加入。
            </p>
          </div>
        ) : null}

        {err ? <ErrLine text={err} /> : null}
      </div>
    </div>
  );
}

function DetailStep({
  picked,
  already,
  status,
  setStatus,
  tags,
  setTags,
  extra,
  setExtra,
  showExtra,
  setShowExtra,
  busy,
  err,
  onBack,
  onSubmit,
  onGo,
}: {
  picked: Picked;
  already: boolean;
  status: Status;
  setStatus: (s: Status) => void;
  tags: string[];
  setTags: (f: (prev: string[]) => string[]) => void;
  extra: string;
  setExtra: (v: string) => void;
  showExtra: boolean;
  setShowExtra: (v: boolean) => void;
  busy: boolean;
  err: string | null;
  onBack: () => void;
  onSubmit: () => void;
  onGo: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h3 className="text-base font-bold text-ink">
          {nameWithCode(picked.name, picked.ticker)}
        </h3>
        {already ? (
          <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
            已在自选
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold text-muted">你是：</p>
        <div className="mt-2 flex gap-2">
          {(
            [
              ["HOLDING", "已持仓"],
              ["WATCH", "在观察"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              disabled={already}
              onClick={() => setStatus(v)}
              className={`flex-1 rounded-xl border px-4 py-2.5 text-sm transition-colors disabled:opacity-50 ${
                status === v
                  ? "border-brand bg-brand/10 font-medium text-brand"
                  : "border-line bg-surface text-muted hover:border-brand"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {already ? (
          <p className="mt-1.5 text-[11px] text-muted">
            这只已经在你的自选里，持仓状态与成本记录保持原样；下面选的理由会补进它的投资逻辑。
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold text-muted">
          你{status === "HOLDING" ? "看好" : "关注"}它什么？
          <span className="ml-1 font-normal">可多选，也可以都不选</span>
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {WATCH_REASONS.map((r) => {
            const on = tags.includes(r.key);
            return (
              <button
                key={r.key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setTags((prev) =>
                    prev.includes(r.key)
                      ? prev.filter((k) => k !== r.key)
                      : [...prev, r.key],
                  )
                }
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                  on
                    ? "border-brand bg-brand/10"
                    : "border-line bg-surface hover:border-brand"
                }`}
              >
                <span
                  className={`block text-sm font-medium ${on ? "text-brand" : "text-ink"}`}
                >
                  {r.label}
                </span>
                <span className="block text-[10.5px] leading-tight text-muted">
                  {r.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        {showExtra ? (
          <textarea
            autoFocus
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder="想多写两句就写，不写也行。"
            className="w-full resize-none rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowExtra(true)}
            className="text-xs text-muted transition-colors hover:text-brand"
          >
            ＋ 想多写两句（可选）
          </button>
        )}
      </div>

      {err ? <ErrLine text={err} /> : null}

      {/* 钉在浮层底缘：矮屏（iPhone SE 375x667）上标签会把主按钮推出可视区，
          要滚到底才够得着——加自选这件事不该再多一步。 */}
      <div className="sticky bottom-0 mt-5 flex gap-3 border-t border-line/60 bg-surface pb-1 pt-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
        >
          返回
        </button>
        {already ? (
          <button
            type="button"
            disabled={busy}
            onClick={onSubmit}
            className="flex-1 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {busy ? "保存中…" : "补进它的投资逻辑"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onSubmit}
            className="flex-1 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {busy ? "加入中…" : "加入自选"}
          </button>
        )}
      </div>

      {already ? (
        <button
          type="button"
          onClick={onGo}
          className="mt-3 w-full text-center text-xs text-muted transition-colors hover:text-brand"
        >
          直接去它的逻辑档案 →
        </button>
      ) : null}
    </div>
  );
}

function DoneStep({
  picked,
  onMore,
  onGo,
}: {
  picked: Picked;
  onMore: () => void;
  onGo: () => void;
}) {
  return (
    <div>
      <p className="text-sm leading-relaxed text-ink/90">
        解牛已经开始盯着{" "}
        <strong className="text-brand">
          {nameWithCode(picked.name, picked.ticker)}
        </strong>{" "}
        了。之后只在触及它投资逻辑的实质变化时提醒你，其余静音。
      </p>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onMore}
          className="rounded-full border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
        >
          再加一只
        </button>
        <button
          type="button"
          onClick={onGo}
          className="flex-1 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          进入逻辑档案 →
        </button>
      </div>
    </div>
  );
}

function ErrLine({ text }: { text: string }) {
  return (
    <p className="mt-3 text-xs text-red-600 dark:text-red-400">{text}</p>
  );
}
