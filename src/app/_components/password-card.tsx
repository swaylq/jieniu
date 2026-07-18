"use client";

import { type FormEvent, useState } from "react";

import { api } from "~/trpc/react";

import { fieldCls } from "./section-head";

const inputCls = fieldCls;

/** 账号安全（U-3）：设置 / 修改登录密码。与邮箱验证码登录并存。 */
export function PasswordCard() {
  const utils = api.useUtils();
  const hasPasswordQ = api.account.hasPassword.useQuery();
  const hasPassword = hasPasswordQ.data?.hasPassword ?? false;

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setPassword = api.account.setPassword.useMutation({
    onSuccess: () => {
      setMsg({ ok: true, text: "密码已更新" });
      setCurrent("");
      setNext("");
      setConfirm("");
      setOpen(false);
      void utils.account.hasPassword.invalidate();
    },
    onError: (e) => setMsg({ ok: false, text: e.message }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) {
      setMsg({ ok: false, text: "新密码至少 8 位" });
      return;
    }
    if (next !== confirm) {
      setMsg({ ok: false, text: "两次输入的新密码不一致" });
      return;
    }
    setPassword.mutate({
      newPassword: next,
      currentPassword: hasPassword ? current : undefined,
    });
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-ink">登录密码</h3>
          <p className="mt-0.5 text-xs text-muted">
            {hasPassword
              ? "已设置 · 可用邮箱 + 密码登录"
              : "未设置 · 设置后可用邮箱 + 密码登录（验证码登录仍可用）"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setMsg(null);
          }}
          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand hover:text-brand"
        >
          {open ? "取消" : hasPassword ? "修改密码" : "设置密码"}
        </button>
      </div>

      {open ? (
        <form onSubmit={submit} className="mt-3 space-y-2.5">
          {hasPassword ? (
            <input
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="当前密码"
              className={inputCls}
            />
          ) : null}
          <input
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="新密码（至少 8 位）"
            className={inputCls}
          />
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="再次输入新密码"
            className={inputCls}
          />
          <button
            type="submit"
            disabled={setPassword.isPending}
            className="w-full rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {setPassword.isPending ? "保存中…" : "保存密码"}
          </button>
        </form>
      ) : null}

      {msg ? (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            msg.ok
              ? "bg-brand/10 text-brand-dark dark:text-brand"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          }`}
        >
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
