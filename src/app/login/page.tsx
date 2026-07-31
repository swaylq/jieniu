import { Suspense } from "react";

import { smsConfigured } from "~/server/sms";
import { LoginForm } from "./login-form";

/**
 * 登录页。`canSms` 在**服务端**算好传下去——手机号那一档是否存在不该等一个客户端查询回来，
 * 否则首帧会渲染出一个还没有 tab 的手机号表单，闪一下才切回邮箱。
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[70vh] items-center justify-center p-6">
          <p className="text-sm text-muted">加载中…</p>
        </main>
      }
    >
      <LoginForm canSms={smsConfigured()} />
    </Suspense>
  );
}
