import { auth } from "~/server/auth";
import { api } from "~/trpc/server";
import {
  PLAN_META,
  STANDARD_FEATURES,
  PLUS_ONLY_FEATURES,
  FEATURE_LABEL,
  planFeatures,
  type PlanTier,
  type PlanFeature,
} from "~/lib/plan";

export const dynamic = "force-dynamic";

const ALL_FEATURES: PlanFeature[] = [...STANDARD_FEATURES, ...PLUS_ONLY_FEATURES];

function PlanColumn({ tier, current }: { tier: PlanTier; current: boolean }) {
  const meta = PLAN_META[tier];
  const feats = planFeatures(tier);
  const isPlus = tier === "PLUS";
  return (
    <div
      className={`flex flex-col rounded-2xl border p-6 ${
        isPlus ? "border-brand/40 bg-brand/[0.05]" : "border-line bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-ink">{meta.name}</h2>
        {current ? (
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
            当前
          </span>
        ) : null}
        {isPlus ? (
          <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-white">
            盯行情
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-extrabold text-ink">{meta.price}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{meta.tagline}</p>
      <ul className="mt-4 flex-1 space-y-2.5">
        {ALL_FEATURES.map((f) => {
          const on = feats.includes(f);
          return (
            <li key={f} className="flex gap-2 text-sm leading-relaxed">
              <span
                className={`shrink-0 ${on ? "text-brand" : "text-muted/40"}`}
                aria-hidden
              >
                {on ? "✓" : "—"}
              </span>
              <span className={on ? "text-ink/85" : "text-muted/50"}>
                {FEATURE_LABEL[f]}
              </span>
            </li>
          );
        })}
      </ul>
      {isPlus ? (
        <button
          disabled
          className="mt-5 cursor-not-allowed rounded-xl border border-brand/40 bg-brand/10 px-4 py-2.5 text-sm font-semibold text-brand opacity-70"
        >
          升级 Plus · 即将开放
        </button>
      ) : (
        <div className="mt-5 rounded-xl border border-line px-4 py-2.5 text-center text-sm font-medium text-muted">
          {current ? "当前方案" : "已含全部核心监控"}
        </div>
      )}
    </div>
  );
}

export default async function PlusPage() {
  const session = await auth();
  const plan: PlanTier = session?.user ? await api.billing.myPlan() : "STANDARD";

  return (
    <main className="mx-auto max-w-2xl p-4 lg:max-w-4xl">
      <header className="pt-1 pb-5">
        <div className="flex items-center gap-2.5">
          <span className="h-6 w-1.5 rounded-full bg-brand" aria-hidden />
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">
            解牛会员
          </h1>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          降噪 + 盯逻辑是根本；盯行情是进阶。按你需要的深度选。
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <PlanColumn tier="STANDARD" current={plan === "STANDARD"} />
        <PlanColumn tier="PLUS" current={plan === "PLUS"} />
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-muted">
        会员为资讯监控与分析工具；AI 行情分析仅为客观信息的 AI 归纳，非投资建议、不预测涨跌、不构成买卖依据。支付通道即将开放。
      </p>
    </main>
  );
}
