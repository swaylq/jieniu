import { PERSONA_TABS, type InterpretKind } from "~/lib/personas";
import type { Compass } from "~/lib/master-compass";

function meta(kind: InterpretKind) {
  return PERSONA_TABS.find((t) => t.kind === kind)!;
}

type Row = { kind: InterpretKind; score: number; focus: string };

/**
 * 大师视角罗盘（P5-12：降级为可选镜头）：把 4 位大师放在同一条「视角契合度」轴上，
 * 一眼看哪种投资框架更贴合这条资讯。默认的中性解读在本罗盘之外、优先展示；
 * 这里只是「换个框架看看」的可选镜头。点任一行加载该视角的演示解读。
 * 全程非方向性——不是评级、不预测涨跌（合规）。
 */
export function MasterCompass({
  compass,
  active,
  loading,
  onSelect,
}: {
  compass: Compass;
  active: InterpretKind | null;
  loading: InterpretKind | null;
  onSelect: (kind: InterpretKind) => void;
}) {
  const rows: Row[] = compass.entries.map((e) => ({
    kind: e.kind,
    score: e.score,
    focus: e.focus,
  }));
  return (
    <div>
      <div className="mb-2 flex items-start gap-1.5 rounded-md bg-brand/[0.06] px-2.5 py-1.5">
        <span
          className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
          aria-hidden
        />
        <span className="text-xs leading-relaxed text-ink/80">
          {compass.headline}
        </span>
      </div>
      <div className="space-y-0.5">
        {rows.map((r) => {
          const m = meta(r.kind);
          const isActive = active === r.kind;
          const isLoading = loading === r.kind;
          return (
            <button
              key={r.kind}
              type="button"
              onClick={() => onSelect(r.kind)}
              aria-pressed={isActive}
              className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors ${
                isActive
                  ? "bg-brand/10 ring-1 ring-brand/30"
                  : "hover:bg-surface"
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[10px] font-semibold text-brand">
                {m.mono}
              </span>
              <span className="w-14 shrink-0 text-xs font-medium text-ink">
                {m.label}
              </span>
              <span
                className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line/60"
                aria-hidden
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-brand/70"
                  style={{ width: `${r.score}%` }}
                />
              </span>
              <span className="w-[92px] shrink-0 truncate text-right text-[11px] text-muted">
                {isLoading ? "生成中…" : r.focus}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
        视角契合度 · 衡量各投资哲学与本条资讯的相关度，仅供换个框架参考，非评级、非涨跌预测
      </p>
    </div>
  );
}
