"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "~/trpc/react";
import { brandBtn, fieldClsSm } from "./section-head";
import { useWatchlistRefresh } from "./use-watchlist-refresh";

/**
 * 截图导入持仓（2026-08-27，Blackie 提需求、楚寒拍板「这个好做」）。
 *
 * 流程：选券商 App 持仓页截图 → 客户端压缩 → `portfolio.recognizeScreenshot` 识别
 * → **确认表**（逐行核对/改数字/删行，「再传一张」按标的去重追加）→ `portfolio.importBatch`。
 *
 * 识别和导入之间永远隔着用户确认——截图里是真实资产数字，模型看错一个数、
 * 用户没复核就入库，比手动录入还危险。确认表就是这个闸。
 *
 * 隐私：图片只在客户端压缩后经 tRPC 传一次，服务端不落盘不存留（见 vision.ts 注释），
 * 文案要把这一点跟用户说死。
 *
 * v1 边界：只认 A 股（全库实体/行情就只有沪深京），港美股/基金行在确认表灰显原因；
 * 「猜的」行只能剔除不能就地换标的（要换先删掉这只，回头用加自选搜）——换标的留 v1.1。
 */

/** 确认表里一行的草稿（服务端 ok 行 + 用户编辑态）。 */
type Draft = {
  entityId: string;
  name: string;
  ticker: string;
  match: "matched" | "guessed";
  existing: { status: string; costBasis: number | null; shares: number | null } | null;
  included: boolean;
  /** 受控输入，字符串持有，提交时才 parse。 */
  shares: string;
  cost: string;
};

/** 不能导入的行（unsupported/failed/skipped 统一灰显）。 */
type Reject = { key: string; name: string; note: string };

type Step = "pick" | "confirm" | "done";

/** 数字输入解析：千分位/单位/货币符号都洗掉，空或非法 → null（服务端还会再清洗一遍）。 */
function parseDraftNum(s: string): number | null {
  const t = s.replace(/[,，\s¥￥元股]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 客户端压缩：长边压到 ≤2000px 转 JPEG——截图原图好几 MB，压完通常几百 KB，识别精度不受损。 */
async function fileToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 触发按钮。挂在 /profile「我的持仓」标题旁（SectionHead action），浮层状态自持。 */
export function ImportHoldingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-brand/40 px-3 py-1 font-semibold text-brand transition-colors hover:bg-brand/5"
      >
        截图导入
      </button>
      <ImportHoldingsSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function ImportHoldingsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const refreshWatchViews = useWatchlistRefresh();

  const [step, setStep] = useState<Step>("pick");
  const [busy, setBusy] = useState<string | null>(null); // 忙碌文案：识别中… / 导入中…
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [rejects, setRejects] = useState<Reject[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 必须挂到 body 上（portal）：页面外层动画末帧会给 position:fixed 造 containing block，
  // 就地渲染 inset-0 量的是整页高度而不是视口（同 add-watch-sheet 注释的坑）。
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

  const recognize = api.portfolio.recognizeScreenshot.useMutation();
  const importBatch = api.portfolio.importBatch.useMutation();

  function reset() {
    setStep("pick");
    setBusy(null);
    setDrafts([]);
    setRejects([]);
    setNotice(null);
    setErr(null);
    setResult(null);
  }

  function close() {
    reset();
    onClose();
  }

  /** 把一张图的识别结果并入草稿：按标的去重，已在列表里的保留用户编辑过的版本。
   *  注意在 setState 外面算好再 set——updater 必须纯，放里面算会被 StrictMode 双调把计数翻倍。 */
  function mergeResult(r: {
    rows: (
      | {
          kind: "ok";
          entityId: string;
          name: string;
          ticker: string;
          match: "matched" | "guessed";
          shares: number | null;
          costBasis: number | null;
          existing: { status: string; costBasis: number | null; shares: number | null } | null;
        }
      | { kind: "unsupported"; name: string; reason: string }
      | { kind: "failed"; name: string; message: string }
    )[];
    skipped: { name: string; reason: string }[];
  }) {
    let added = 0;
    let dup = 0;
    const have = new Set(drafts.map((d) => d.entityId));
    const next = [...drafts];
    for (const row of r.rows) {
      if (row.kind !== "ok") continue;
      if (have.has(row.entityId)) {
        dup++;
        continue;
      }
      have.add(row.entityId);
      next.push({
        entityId: row.entityId,
        name: row.name,
        ticker: row.ticker,
        match: row.match,
        existing: row.existing,
        included: true,
        shares: row.shares != null ? String(row.shares) : "",
        cost: row.costBasis != null ? String(row.costBasis) : "",
      });
      added++;
    }
    setDrafts(next);

    const rHave = new Set(rejects.map((x) => x.key));
    const rNext = [...rejects];
    const push = (name: string, note: string) => {
      const key = `${name}:${note}`;
      if (rHave.has(key)) return;
      rHave.add(key);
      rNext.push({ key, name, note });
    };
    for (const row of r.rows) {
      if (row.kind === "unsupported") push(row.name, `暂不支持：${row.reason}`);
      if (row.kind === "failed") push(row.name, row.message);
    }
    for (const s of r.skipped) push(s.name, `已跳过：${s.reason}`);
    setRejects(rNext);

    setNotice(
      r.rows.length === 0 && r.skipped.length === 0
        ? "这张图没认出持仓内容——换张包含「名称/代码/持仓数量/成本价」列的券商持仓页截图试试。"
        : `这张图认出 ${added} 条持仓${dup > 0 ? `，${dup} 条已在列表中（保留你改过的）` : ""}。`,
    );
  }

  async function handleFile(file: File) {
    setErr(null);
    setNotice(null);
    let dataUrl: string;
    try {
      dataUrl = await fileToDataUrl(file);
    } catch {
      setErr("这张图片读不出来，请用券商 App 的持仓页截图（PNG/JPEG）。");
      return;
    }
    setBusy("识别中…");
    try {
      const r = await recognize.mutateAsync({ dataUrl });
      mergeResult(r);
      setStep("confirm");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "识别失败，稍后再试。");
      if (drafts.length > 0) setStep("confirm");
    } finally {
      setBusy(null);
    }
  }

  async function doImport() {
    const rows = drafts
      .filter((d) => d.included)
      .map((d) => ({
        entityId: d.entityId,
        costBasis: parseDraftNum(d.cost),
        shares: parseDraftNum(d.shares),
      }));
    if (rows.length === 0) return;
    setErr(null);
    setBusy("导入中…");
    try {
      const r = await importBatch.mutateAsync({ rows });
      refreshWatchViews();
      setResult(r);
      setStep("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "导入失败，稍后再试。");
    } finally {
      setBusy(null);
    }
  }

  if (!open || !mounted) return null;

  const includedCount = drafts.filter((d) => d.included).length;
  const title =
    step === "done" ? "导入完成" : step === "confirm" ? "确认导入" : "截图导入持仓";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="截图导入持仓"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={close}
        className="fixed inset-0 cursor-default bg-black/40 backdrop-blur-sm"
      />
      <div className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-bold text-ink">{title}</h2>
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
          {busy ? (
            <div className="flex flex-col items-center py-10">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand" />
              <p className="mt-4 text-sm text-ink">{busy}</p>
              {busy.startsWith("识别") ? (
                <p className="mt-1.5 text-xs text-muted">
                  截图仅用于本次识别，识别完即丢弃，服务器不保存。
                </p>
              ) : null}
            </div>
          ) : step === "pick" ? (
            <PickStep err={err} onPick={() => fileRef.current?.click()} />
          ) : step === "confirm" ? (
            <ConfirmStep
              drafts={drafts}
              setDrafts={setDrafts}
              rejects={rejects}
              setRejects={setRejects}
              notice={notice}
              err={err}
              includedCount={includedCount}
              importing={importBatch.isPending}
              onMore={() => fileRef.current?.click()}
              onImport={() => void doImport()}
            />
          ) : (
            <DoneStep result={result} onClose={close} />
          )}
        </div>
      </div>

      {/* 隐藏文件输入：选图与「再传一张」共用。onChange 后清空 value，同一张图能再选。 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handleFile(f);
        }}
      />
    </div>,
    document.body,
  );
}

/* ── 步骤组件一律定义在模块作用域 ─────────────────────────────────────────
   写在父组件体内会让受控输入每敲一个字失焦一次（add-watch-sheet 同款教训）。 */

function PickStep({ err, onPick }: { err: string | null; onPick: () => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-line bg-canvas px-4 py-8 transition-colors hover:border-brand/50"
      >
        <span className="text-2xl">📷</span>
        <span className="mt-2 text-sm font-semibold text-ink">选择券商持仓页截图</span>
        <span className="mt-1 text-xs text-muted">PNG / JPEG，上传前会自动压缩</span>
      </button>
      <ul className="mt-4 space-y-1.5 text-xs leading-relaxed text-muted">
        <li>· 截图里要能看到「名称 / 代码 / 持仓数量 / 成本价」列；多页持仓可以一张一张传。</li>
        <li>· 识别后先给你确认表核对，点头才入库——不会直接写进你的持仓。</li>
        <li>· 截图仅用于本次识别，识别完即丢弃，服务器不保存。</li>
        <li>· 暂只导入 A 股；港股 / 美股 / 基金会标出来由你过目。</li>
      </ul>
      {err ? <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{err}</p> : null}
    </div>
  );
}

function ConfirmStep({
  drafts,
  setDrafts,
  rejects,
  setRejects,
  notice,
  err,
  includedCount,
  importing,
  onMore,
  onImport,
}: {
  drafts: Draft[];
  setDrafts: (fn: (prev: Draft[]) => Draft[]) => void;
  rejects: Reject[];
  setRejects: (fn: (prev: Reject[]) => Reject[]) => void;
  notice: string | null;
  err: string | null;
  includedCount: number;
  importing: boolean;
  onMore: () => void;
  onImport: () => void;
}) {
  const patch = (entityId: string, p: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.entityId === entityId ? { ...d, ...p } : d)));
  const removeDraft = (entityId: string) =>
    setDrafts((prev) => prev.filter((d) => d.entityId !== entityId));
  const removeReject = (key: string) => setRejects((prev) => prev.filter((x) => x.key !== key));

  return (
    <div>
      {notice ? <p className="mb-3 text-xs leading-relaxed text-muted">{notice}</p> : null}

      {drafts.length > 0 ? (
        <ul className="space-y-2">
          {drafts.map((d) => (
            <li
              key={d.entityId}
              className={`rounded-xl border border-line bg-canvas px-3 py-2.5 ${d.included ? "" : "opacity-50"}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={d.included}
                  onChange={(e) => patch(d.entityId, { included: e.target.checked })}
                  aria-label={`导入 ${d.name}`}
                  className="h-4 w-4 shrink-0 accent-brand"
                />
                <span className="min-w-0 truncate text-sm font-medium text-ink">
                  {d.name}
                  <span className="ml-1 text-xs font-normal text-muted">{d.ticker}</span>
                </span>
                {d.match === "guessed" ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    按名称猜的，请核对
                  </span>
                ) : null}
                {d.existing ? (
                  <span className="shrink-0 text-[10px] text-muted">
                    {d.existing.status === "HOLDING" ? "已在持仓·将更新" : "已在观察·将转为持仓"}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeDraft(d.entityId)}
                  aria-label={`移除 ${d.name}`}
                  className="ml-auto shrink-0 rounded px-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
                >
                  ×
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2 pl-6">
                <label className="flex flex-1 items-center gap-1.5 text-xs whitespace-nowrap text-muted">
                  股数
                  <input
                    value={d.shares}
                    onChange={(e) => patch(d.entityId, { shares: e.target.value })}
                    inputMode="decimal"
                    placeholder="—"
                    className={fieldClsSm}
                  />
                </label>
                <label className="flex flex-1 items-center gap-1.5 text-xs whitespace-nowrap text-muted">
                  成本
                  <input
                    value={d.cost}
                    onChange={(e) => patch(d.entityId, { cost: e.target.value })}
                    inputMode="decimal"
                    placeholder="—"
                    className={fieldClsSm}
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-line bg-canvas p-4 text-center text-sm text-muted">
          还没有可导入的持仓行
        </p>
      )}

      {rejects.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {rejects.map((x) => (
            <li
              key={x.key}
              className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-1.5 text-xs text-muted"
            >
              <span className="min-w-0 truncate">{x.name}</span>
              <span className="min-w-0 flex-1 truncate">{x.note}</span>
              <button
                type="button"
                onClick={() => removeReject(x.key)}
                aria-label={`移除 ${x.name}`}
                className="shrink-0 rounded px-1 hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {err ? <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{err}</p> : null}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onMore}
          className="rounded-full border border-line px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand/50 hover:text-brand"
        >
          再传一张
        </button>
        <button
          type="button"
          disabled={includedCount === 0 || importing}
          onClick={onImport}
          className={`${brandBtn} flex-1`}
        >
          导入 {includedCount} 条持仓
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        已在持仓的标的只会用截图里的股数/成本更新，你手录的其它信息不动。
      </p>
    </div>
  );
}

function DoneStep({
  result,
  onClose,
}: {
  result: { created: number; updated: number } | null;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-6">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-xl text-brand">
        ✓
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">
        {result
          ? `新建 ${result.created} 条持仓${result.updated > 0 ? `，更新 ${result.updated} 条` : ""}`
          : "导入完成"}
      </p>
      <p className="mt-1.5 text-center text-xs leading-relaxed text-muted">
        成本 / 股数仅供观察与个性化提醒，非投资建议、不计算盈亏。
      </p>
      <button type="button" onClick={onClose} className={`${brandBtn} mt-5 px-8`}>
        完成
      </button>
    </div>
  );
}
