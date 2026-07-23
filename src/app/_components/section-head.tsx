import type { ReactNode } from "react";

/**
 * 页面级大标题（h1 masthead / hero）专用：衬线 display 字族，给「研究简报」的编辑感。
 * 只给 `<h1>` 用——正文/按钮/分区小标题一律无衬线。尺寸由调用方给（各页需求不同）。
 * 见 DESIGN.md「Typography」。
 */
export const displayCls = "font-display font-bold tracking-tight text-ink";

/** 统一分区标题：ink 粗体 + 可选 hint + 可选右侧动作。全 App 各页分区共用。 */
export function SectionHead({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-bold text-ink">{title}</h2>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
      {action ? <div className="shrink-0 text-xs">{action}</div> : null}
    </div>
  );
}

/** 统一实体 chip 药丸样式（发丝边框，hover 变琥珀，明暗自适应）。 */
export const chipClass =
  "inline-flex items-center rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-brand hover:text-brand";

/** 主按钮：浅色近黑药丸 / 深色反白，明暗都清晰（不随 ink 变量翻转以免撞底色）。 */
export const primaryBtn =
  "inline-block rounded-full bg-[#0b0d12] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-black dark:bg-white dark:text-[#0b0d12] dark:hover:bg-gray-200";

/** 强调实心按钮（品牌 amber，如登录提交）：hover 加深 + disabled 态。 */
export const brandBtn =
  "inline-flex items-center justify-center rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60";

/** 统一输入框：明暗自适应、focus 有 amber 描边环 + 边框变色。全 App 输入框共用，避免各处样式漂移。 */
export const fieldCls =
  "w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-60";

/** 紧凑输入框（密集编辑器内用）：同款 focus 反馈，仅更小内距 / 圆角。 */
export const fieldClsSm =
  "w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-60";
