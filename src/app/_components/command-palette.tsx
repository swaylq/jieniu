"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { entityTypeLabel, moveHighlight } from "~/lib/format";
import { matchNav } from "~/lib/command-nav";

type PaletteCtx = { open: boolean; setOpen: (v: boolean) => void };

const Ctx = createContext<PaletteCtx | null>(null);

/** 侧栏「搜索」按钮用它打开命令面板。 */
export function useCommandPalette(): PaletteCtx {
  const c = useContext(Ctx);
  if (!c) {
    throw new Error("useCommandPalette 必须在 CommandPaletteProvider 内使用");
  }
  return c;
}

/** 全局挂载：提供开合状态 + 渲染 ⌘K 弹层。 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Ctx.Provider value={{ open, setOpen }}>
      {children}
      <CommandPaletteOverlay open={open} setOpen={setOpen} />
    </Ctx.Provider>
  );
}

function CommandPaletteOverlay({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = q.trim();
  const query = api.entity.search.useQuery(
    { q: trimmed },
    { enabled: open && trimmed.length > 0 },
  );
  const results = query.data ?? [];

  // 快捷前往命令（空查询=启动器默认项；有查询=按 label/助记匹配）+ 实体搜索结果，合并成一个可键盘导航的列表。
  const navItems = matchNav(q);
  const entityItems = trimmed.length > 0 ? results : [];
  const hrefs = [
    ...navItems.map((n) => n.href),
    ...entityItems.map((e) => `/entity/${e.id}`),
  ];

  // 全局 ⌘K / Ctrl-K 打开·关闭，Esc 关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // 打开时聚焦；关闭时清空
  useEffect(() => {
    if (open) {
      setHighlight(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    setQ("");
  }, [open]);

  // 关键词变化时高亮回到首项
  useEffect(() => {
    setHighlight(0);
  }, [trimmed]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => moveHighlight(h, 1, hrefs.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => moveHighlight(h, -1, hrefs.length));
    } else if (e.key === "Enter") {
      const href = hrefs[highlight];
      if (href) go(href);
    }
  }

  if (!open) return null;

  const rowCls = (active: boolean) =>
    `flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors ${
      active ? "bg-brand/10" : "hover:bg-canvas"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="关闭搜索"
        onClick={() => setOpen(false)}
        className="fixed inset-0 cursor-default bg-black/40 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="前往 / 搜索板块 · 公司 · 股票代码…"
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-sm text-ink outline-none placeholder:text-muted"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {hrefs.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">
              {query.isFetching ? "搜索中…" : "无匹配结果"}
            </li>
          ) : (
            <>
              {navItems.map((n, i) => (
                <li key={n.href}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => go(n.href)}
                    className={rowCls(i === highlight)}
                  >
                    <span className="text-sm text-ink">
                      {n.label}
                      <span className="ml-1.5 text-xs text-muted">{n.sub}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">前往</span>
                  </button>
                </li>
              ))}
              {entityItems.map((e, j) => {
                const i = navItems.length + j;
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => go(`/entity/${e.id}`)}
                      className={rowCls(i === highlight)}
                    >
                      <span className="text-sm text-ink">
                        {e.name}
                        {e.ticker ? (
                          <span className="tabular ml-1.5 text-xs text-muted">
                            {e.ticker}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted">
                        {entityTypeLabel(e.type)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </>
          )}
        </ul>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-muted">
          <span>↑↓ 选择 · ↵ 前往 · Esc 关闭</span>
          <span>解牛 · 快捷前往/搜索</span>
        </div>
      </div>
    </div>
  );
}
