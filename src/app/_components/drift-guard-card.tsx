import { driftHeadline, type DriftLevel } from "~/lib/drift";

/** Thesis Drift 挑战卡（P4-5）。促自查、非指令；amber/灰，不涉红绿。用于 DecisionEditor 客户端上下文。 */
export function DriftGuardCard({
  level,
  message,
  onConfirm,
  onCancel,
  pending,
}: {
  level: DriftLevel;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  return (
    <div className="rounded-xl border border-brand/40 bg-brand/[0.06] p-3.5">
      <div className="flex items-center gap-2">
        <span aria-hidden>🛡️</span>
        <h4 className="text-sm font-bold text-ink">{driftHeadline(level)}</h4>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink/85">{message}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "录入中…" : "我已重新评估，确认录入"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-xs text-muted transition-colors hover:text-ink"
        >
          再想想 / 取消
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        这是帮你自查的提问，不是投资建议、不构成买卖依据；最终决策在你。
      </p>
    </div>
  );
}
