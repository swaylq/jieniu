import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { PasswordCard } from "../_components/password-card";
import { LogoutButton } from "../_components/logout-button";
import { ThemeToggle } from "../_components/theme-toggle";
import { ColorblindToggle } from "../_components/colorblind-toggle";
import { SectionHead, displayCls } from "../_components/section-head";
import { LogoMark } from "../_components/logo";

export const dynamic = "force-dynamic";

/** 账号设置中心（U-4）：账号信息 / 密码 / 偏好 / 退出——把散落各处的设置收拢一处。 */
export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?returnTo=/settings");

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-3xl">
      <header className="pb-4 pt-1">
        <div className="flex items-center gap-2.5">
          <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
          <h1 className={`text-2xl ${displayCls}`}>
            设置
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted">账号与偏好</p>
      </header>

      <section className="mt-2">
        <SectionHead title="账号" />
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
            <LogoMark className="h-10 w-10 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">
                {session.user.email}
              </p>
              <p className="text-xs text-muted">解牛用户</p>
            </div>
          </div>
          <PasswordCard />
        </div>
      </section>

      <section className="mt-8">
        <SectionHead title="偏好" />
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">深色 / 浅色</p>
              <p className="mt-0.5 text-xs text-muted">切换界面主题</p>
            </div>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">色盲友好</p>
              <p className="mt-0.5 text-xs text-muted">橙涨蓝跌，替代红绿</p>
            </div>
            <ColorblindToggle />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <SectionHead title="退出登录" />
        <div className="rounded-xl border border-line bg-surface p-4">
          <LogoutButton />
        </div>
      </section>
    </main>
  );
}
