import Link from "next/link";
import { redirect } from "next/navigation";
import { type Metadata } from "next";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { AvatarEditor } from "../../_components/avatar-editor";
import { displayCls } from "../../_components/section-head";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "头像",
  robots: { index: false },
};

/** 头像设置：上传照片 / 文字头像 / 恢复默认。入口在设置页账号卡。 */
export default async function AvatarSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?returnTo=/settings/avatar");

  const u = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, image: true, avatarColor: true, avatarChar: true },
  });

  return (
    // pb-24：给右下角浮动的「问解牛」留出滚动余量，否则最后一张卡永远压在它底下。
    <main className="mx-auto max-w-2xl p-4 pb-24 lg:max-w-3xl">
      <header className="pb-4 pt-1">
        <Link
          href="/settings"
          className="text-xs text-muted transition-colors hover:text-brand"
        >
          ← 设置
        </Link>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
          <h1 className={`text-2xl ${displayCls}`}>头像</h1>
        </div>
        <p className="mt-2 text-sm text-muted">
          只有你自己看得到——侧栏、我的组合、设置页都用它
        </p>
      </header>

      <AvatarEditor
        initial={{
          image: u?.image ?? null,
          avatarColor: u?.avatarColor ?? null,
          avatarChar: u?.avatarChar ?? null,
        }}
        seed={u?.email ?? session.user.email ?? null}
      />
    </main>
  );
}
