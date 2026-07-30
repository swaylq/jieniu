import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "~/server/db";
import { displayCls, primaryBtn } from "../_components/section-head";

export const dynamic = "force-dynamic";
export const metadata = { title: "退订提醒邮件 · 解牛", robots: { index: false } };

/**
 * 免登录退订。**必须是 POST**——邮件客户端与安全网关会预抓 GET 链接，
 * 做成一键 GET 退订会被扫描器误触，把用户悄悄退掉。所以这里只渲染一个确认按钮。
 */
async function unsubscribe(formData: FormData) {
  "use server";
  // formData.get 可能返回 File；只接受字符串，别靠 String() 兜底（会变成 "[object File]"）。
  const raw = formData.get("t");
  const token = typeof raw === "string" ? raw : "";
  if (token) {
    await db.user.updateMany({
      where: { alertEmailToken: token },
      data: { alertEmail: false },
    });
  }
  redirect(`/unsubscribe?t=${encodeURIComponent(token)}&done=1`);
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  const done = sp.done === "1";

  const user = token
    ? await db.user.findUnique({
        where: { alertEmailToken: token },
        select: { email: true, alertEmail: true },
      })
    : null;

  return (
    <main className="mx-auto max-w-lg p-4">
      <header className="pt-6 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
          <h1 className={`text-2xl ${displayCls}`}>退订提醒邮件</h1>
        </div>
      </header>

      <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
        {!user ? (
          <p className="text-sm leading-relaxed text-muted">
            这个退订链接无效或已过期。你也可以登录后在
            <span className="font-medium text-ink">提醒中心</span>
            关掉「邮件投递」开关。
          </p>
        ) : done || !user.alertEmail ? (
          <>
            <p className="text-sm leading-relaxed text-ink">
              已退订。{user.email ? `${user.email} ` : ""}不会再收到解牛的提醒邮件。
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              提醒仍会留在站内的「最新推送」里——只是不再主动发信打扰你。
            </p>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-ink">
              确认要停止接收解牛的提醒邮件吗？
              {user.email ? (
                <>
                  {" "}
                  当前邮箱：<span className="font-medium">{user.email}</span>
                </>
              ) : null}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              退订后提醒仍会留在站内的「最新推送」里，只是不再发信。
            </p>
            <form action={unsubscribe} className="mt-4">
              <input type="hidden" name="t" value={token} />
              <button type="submit" className={primaryBtn}>
                确认退订
              </button>
            </form>
          </>
        )}
        <div className="mt-5 border-t border-line pt-4">
          <Link href="/notifications" className="text-sm text-brand hover:underline">
            打开提醒中心 →
          </Link>
        </div>
      </div>
    </main>
  );
}
