// 定时任务运行记录（只读）。
//
// 需要登录才能看（未登录 redirect 到 /login?returnTo=/admin/jobs）。仍然只读，
// 不放任何触发 / 禁用按钮——能改数据的按钮不该出现在任何登录用户都能访问的页面上。
//   · robots noindex（robots.ts 里也对 /admin 整体 disallow，双保险）
//   · output 已在 runner 里脱敏（脚本 stdout 里有真实用户邮箱）
// 不要在本页加任何写操作。

import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { displayCls } from "../../_components/section-head";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "定时任务",
  robots: { index: false, follow: false },
};

/** 状态 → 徽标类名。用设计系统的语义色，别用裸 neutral。 */
const BADGE: Record<string, string> = {
  ok: "bg-up/15 text-up",
  fail: "bg-down/15 text-down",
  timeout: "bg-brand/15 text-brand-dark",
  skipped: "bg-faint text-muted",
  running: "bg-brand/10 text-brand-dark",
};

/** 时间线小方块的填充色。 */
const DOT: Record<string, string> = {
  ok: "bg-up/70",
  fail: "bg-down/70",
  timeout: "bg-brand/70",
  skipped: "bg-line",
  running: "bg-brand/40",
};

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

type AlertRow = { id: string; message: string };

export default async function AdminJobsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?returnTo=/admin/jobs");

  const [states, runs] = await Promise.all([
    db.jobState.findMany({ orderBy: { key: "asc" } }),
    db.jobRun.findMany({ orderBy: { firedAt: "desc" }, take: 200 }),
  ]);

  const byKey = new Map<string, typeof runs>();
  for (const r of runs) {
    const list = byKey.get(r.jobKey) ?? [];
    if (list.length < 20) list.push(r);
    byKey.set(r.jobKey, list);
  }

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-4xl">
      <header className="pt-1 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
          <h1 className={`text-2xl ${displayCls}`}>定时任务</h1>
        </div>
        <p className="mt-2 text-sm text-muted">
          服务内调度器（jieniu-scheduler）。本页只读——启停走{" "}
          <code className="rounded bg-faint px-1">scripts/start-scheduler.sh</code>
          。时间为北京时间。
        </p>
      </header>

      <div className="space-y-3">
        {states.length === 0 && (
          <p className="rounded-xl border border-line bg-surface p-8 text-center text-muted">
            还没有任务记录——worker 起来后会自动补齐 9 行。
          </p>
        )}

        {states.map((s) => {
          const list = byKey.get(s.key) ?? [];
          const last = list[0];
          const alerts = Array.isArray(last?.alerts)
            ? (last.alerts as unknown as AlertRow[])
            : [];
          return (
            <section
              key={s.key}
              className="rounded-xl border border-line bg-surface p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <code className="text-sm font-semibold text-ink">{s.key}</code>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${BADGE[s.lastStatus ?? ""] ?? "bg-faint text-muted"}`}
                >
                  {s.lastStatus ?? "从未运行"}
                </span>
                {!s.enabled && (
                  <span className="rounded bg-faint px-2 py-0.5 text-xs text-muted">
                    已禁用
                  </span>
                )}
              </div>

              <p className="mt-1 text-xs text-muted">
                上次 {fmt(s.lastFire)}｜下次 {fmt(s.nextFire)}
                {last?.durationMs != null &&
                  `｜耗时 ${Math.round(last.durationMs / 1000)}s`}
              </p>

              {list.length > 0 && (
                <div className="mt-2 flex gap-1">
                  {list
                    .slice()
                    .reverse()
                    .map((r) => (
                      <span
                        key={r.id}
                        title={`${fmt(r.firedAt)} ${r.status}`}
                        className={`h-3 w-3 rounded-sm ${DOT[r.status] ?? "bg-line"}`}
                      />
                    ))}
                </div>
              )}

              {last?.narration && (
                <p className="mt-3 text-sm text-ink">{last.narration}</p>
              )}

              {alerts.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-down">
                  {alerts.map((a) => (
                    <li key={a.id}>{a.message}</li>
                  ))}
                </ul>
              )}

              {last?.output && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted">
                    输出尾部
                  </summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded bg-canvas p-3 text-xs whitespace-pre-wrap">
                    {last.output}
                  </pre>
                </details>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
