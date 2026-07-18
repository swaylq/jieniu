"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { ALERT_CATEGORIES, type AlertPrefs } from "~/lib/alert-protocol";

/**
 * 提醒协议设置（P5-8）：按分类开关「什么变化值得打扰你」。
 * 逻辑变化/重磅资讯可开关；催化/价格暂无数据源，禁用并标注原因（诚实，不假装）。
 */
export function AlertProtocol({ initial }: { initial: AlertPrefs }) {
  const [prefs, setPrefs] = useState<AlertPrefs>(initial);
  const set = api.notifications.setAlertPref.useMutation({
    onSuccess: (next) => setPrefs(next),
  });

  return (
    <section className="mb-6 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden>🔔</span>
        <h2 className="text-base font-bold text-ink">提醒协议</h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        选择哪些「变化」值得打扰你——解牛只在你选的类别**真的发生变化**时提醒，而不是每条新闻都推。
      </p>
      <ul className="mt-3 divide-y divide-line/60">
        {ALERT_CATEGORIES.map((c) => {
          const on = prefs[c.key];
          const disabled = !c.available || set.isPending;
          return (
            <li
              key={c.key}
              className="flex items-start justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {c.label}
                  </span>
                  {!c.available ? (
                    <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted">
                      {c.soon}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                  {c.desc}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${c.label}提醒`}
                disabled={disabled}
                onClick={() => set.mutate({ category: c.key, enabled: !on })}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${
                  on ? "bg-brand" : "bg-line"
                } ${!c.available ? "cursor-not-allowed opacity-40" : set.isPending ? "opacity-60" : ""}`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    on ? "translate-x-5" : "translate-x-0"
                  }`}
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
