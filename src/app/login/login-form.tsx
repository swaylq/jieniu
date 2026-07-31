"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

import { api } from "~/trpc/react";
import { postLoginRedirect, safeReturnTo } from "~/lib/format";
import { LogoMark } from "../_components/logo";
import { fieldCls, brandBtn } from "../_components/section-head";

const inputCls = fieldCls;
const submitCls = `${brandBtn} w-full`;

/**
 * 手机号那一档是 2026-07-31 加的（张楚寒转述她爹：「登陆怎么还要邮箱啊」「手机号登陆不好吗」）。
 * 排在**最前面**并作为默认：对不常用邮箱的用户，邮箱验证码这一步就是劝退。
 * 短信签名没配时（`auth.smsAvailable` 返回 false）整档隐藏并退回邮箱——
 * 不能让用户点进去才发现发不出。
 */
type Mode = "phone" | "otp" | "password";

export function LoginForm({ canSms }: { canSms: boolean }) {
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));

  // 手机号可用与否由**服务端**决定并作为 prop 传进来（见 page.tsx）：
  // 用 useQuery 会在首帧渲染出一个还没有 tab 的手机号表单，闪一下才切走。
  const [mode, setMode] = useState<Mode>(canSms ? "phone" : "otp");
  const [phone, setPhone] = useState("");
  const [masked, setMasked] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [msg, setMsg] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>(undefined);
  const [verifying, setVerifying] = useState(false);
  const [done, setDone] = useState(false);

  const requestSmsOtp = api.auth.requestSmsOtp.useMutation({
    onSuccess: (res) => {
      setStep("code");
      setDevCode(res.devCode);
      setMasked(res.masked);
      setMsg("");
    },
    onError: (e) => setMsg(e.message),
  });

  const requestOtp = api.auth.requestOtp.useMutation({
    onSuccess: (res) => {
      setStep("code");
      setDevCode(res.devCode);
      setMsg("");
    },
    onError: (e) => setMsg(e.message),
  });

  // 硬跳转：整页导航让服务器读到新 session 并处理 /onboarding→/ 重定向，避免 router 竞态。
  function goAfterLogin() {
    setDone(true);
    window.location.assign(postLoginRedirect(returnTo));
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setMsg("");
    const res = await signIn("credentials", { email, code, redirect: false });
    if (res?.ok) return goAfterLogin();
    setVerifying(false);
    setMsg("验证码错误或已过期，请重试");
  }

  async function submitPhoneCode(e: FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setMsg("");
    const res = await signIn("phone", { phone, code, redirect: false });
    if (res?.ok) return goAfterLogin();
    setVerifying(false);
    setMsg("验证码错误或已过期，请重试");
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setMsg("");
    const res = await signIn("password", { email, password, redirect: false });
    if (res?.ok) return goAfterLogin();
    setVerifying(false);
    setMsg("邮箱或密码不正确");
  }

  function switchMode(next: Mode) {
    setMode(next);
    setStep("email");
    setCode("");
    setPassword("");
    setMsg("");
    setDevCode(undefined);
    setMasked("");
  }

  const tabCls = (active: boolean) =>
    `flex-1 rounded-lg py-1.5 text-center text-xs font-medium transition-colors ${
      active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
    }`;

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
          <div className="mb-5 flex flex-col items-center text-center">
            <LogoMark className="h-12 w-12" />
            <h1 className="mt-3 text-xl font-bold text-ink">登录解牛</h1>
          </div>

          <div className="mb-5 flex gap-1 rounded-xl bg-canvas p-1">
            {canSms ? (
              <button
                type="button"
                onClick={() => switchMode("phone")}
                className={tabCls(mode === "phone")}
              >
                手机号
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => switchMode("otp")}
              className={tabCls(mode === "otp")}
            >
              {canSms ? "邮箱" : "验证码登录"}
            </button>
            <button
              type="button"
              onClick={() => switchMode("password")}
              className={tabCls(mode === "password")}
            >
              {canSms ? "密码" : "密码登录"}
            </button>
          </div>

          {mode === "phone" ? (
            step === "email" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setMsg("");
                  requestSmsOtp.mutate({ phone });
                }}
                className="space-y-3"
              >
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  required
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="手机号"
                  className={inputCls}
                />
                <button
                  type="submit"
                  disabled={requestSmsOtp.isPending}
                  className={submitCls}
                >
                  {requestSmsOtp.isPending ? "发送中…" : "发送验证码"}
                </button>
              </form>
            ) : (
              <form
                onSubmit={(e) => void submitPhoneCode(e)}
                className="space-y-3"
              >
                <p className="text-center text-sm text-muted">
                  验证码已发送至{" "}
                  <span className="tabular font-medium text-ink">{masked}</span>
                </p>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="6 位验证码"
                  className={`${inputCls} text-center text-lg tracking-[0.5em]`}
                />
                <button
                  type="submit"
                  disabled={verifying || done}
                  className={submitCls}
                >
                  {done ? "登录成功，跳转中…" : verifying ? "验证中…" : "登录"}
                </button>
                <div className="flex items-center justify-between pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setMsg("");
                    }}
                    className="text-muted transition-colors hover:text-ink"
                  >
                    换个号码
                  </button>
                  <button
                    type="button"
                    disabled={requestSmsOtp.isPending}
                    onClick={() => {
                      setMsg("");
                      requestSmsOtp.mutate({ phone });
                    }}
                    className="text-brand transition-colors hover:text-brand-dark disabled:opacity-50"
                  >
                    {requestSmsOtp.isPending ? "重新发送中…" : "重新发送"}
                  </button>
                </div>
              </form>
            )
          ) : mode === "otp" ? (
            step === "email" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setMsg("");
                  requestOtp.mutate({ email });
                }}
                className="space-y-3"
              >
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="你的邮箱"
                  className={inputCls}
                />
                <button
                  type="submit"
                  disabled={requestOtp.isPending}
                  className={submitCls}
                >
                  {requestOtp.isPending ? "发送中…" : "发送验证码"}
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => void submitCode(e)} className="space-y-3">
                <p className="text-center text-sm text-muted">
                  验证码已发送至{" "}
                  <span className="font-medium text-ink">{email}</span>
                </p>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="6 位验证码"
                  className={`${inputCls} text-center text-lg tracking-[0.5em]`}
                />
                <button
                  type="submit"
                  disabled={verifying || done}
                  className={submitCls}
                >
                  {done ? "登录成功，跳转中…" : verifying ? "验证中…" : "登录"}
                </button>
                <div className="flex items-center justify-between pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setMsg("");
                    }}
                    className="text-muted transition-colors hover:text-ink"
                  >
                    换个邮箱
                  </button>
                  <button
                    type="button"
                    disabled={requestOtp.isPending}
                    onClick={() => {
                      setMsg("");
                      requestOtp.mutate({ email });
                    }}
                    className="text-brand transition-colors hover:text-brand-dark disabled:opacity-50"
                  >
                    {requestOtp.isPending ? "重新发送中…" : "重新发送"}
                  </button>
                </div>
              </form>
            )
          ) : (
            <form onSubmit={(e) => void submitPassword(e)} className="space-y-3">
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="你的邮箱"
                className={inputCls}
              />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码"
                className={inputCls}
              />
              <button
                type="submit"
                disabled={verifying || done}
                className={submitCls}
              >
                {done ? "登录成功，跳转中…" : verifying ? "登录中…" : "登录"}
              </button>
              <p className="pt-1 text-center text-xs text-muted">
                还没设密码？先用
                <button
                  type="button"
                  onClick={() => switchMode("otp")}
                  className="mx-1 text-brand hover:underline"
                >
                  验证码登录
                </button>
                ，进入「我的」即可设置。
              </p>
            </form>
          )}

          {msg ? (
            <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-center text-xs text-red-600 dark:text-red-400">
              {msg}
            </p>
          ) : null}
          {devCode ? (
            <p className="mt-3 text-center text-xs text-muted">
              开发环境验证码：
              <span className="tabular font-semibold text-brand">{devCode}</span>
            </p>
          ) : null}
        </div>

        <p className="mt-4 text-center text-xs leading-relaxed text-muted">
          登录即同步你的自选股与投资逻辑
          <span className="mx-1.5">·</span>
          <Link href="/" className="text-brand hover:underline">
            返回首页
          </Link>
        </p>
      </div>
    </main>
  );
}

