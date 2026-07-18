import { PERSONA_TABS, type InterpretKind } from "./personas";

/**
 * 解读视角的层级（P5-12 大师视角降级核对）。
 *
 * 解牛的核心解读是**围绕用户投资逻辑（thesis）的相对解读**——「动没动你的逻辑」卡
 * （thesis-lens，事实 → 对逻辑增强/削弱 6 级）承担，优先级最高；其次是**中性客观解读**，
 * 作为通用 AI 解读的默认视角。
 *
 * 「大师视角」（巴菲特/芒格/林奇/格雷厄姆）是**可选的投资思维方式演示镜头**：opt-in、
 * 帮用户换个框架审视，**非核心解读、非投资建议、非大师本人观点**，不作核心品牌承诺。
 */

/** 通用 AI 解读的默认视角：客观中性。 */
export const DEFAULT_INTERPRET_LENS: InterpretKind = "NEUTRAL";

/** 可选的大师视角（降级为 opt-in 镜头），保持 personas 注册表里的顺序。 */
export const MASTER_LENS_KINDS: InterpretKind[] = PERSONA_TABS.map(
  (t) => t.kind,
).filter((k) => k !== DEFAULT_INTERPRET_LENS);

/** 是否为可选的大师视角（非默认视角即大师视角）。 */
export function isMasterLens(kind: InterpretKind): boolean {
  return kind !== DEFAULT_INTERPRET_LENS;
}

/** 是否为默认（中性）视角。 */
export function isDefaultLens(kind: InterpretKind): boolean {
  return kind === DEFAULT_INTERPRET_LENS;
}

/** 大师视角区块的引导文案：明确「可选镜头 / 演示 / 非核心 / 非建议」。 */
export const MASTER_LENS_INTRO =
  "大师视角是可选的投资思维方式演示，帮你换个框架审视这条资讯——非核心解读、非投资建议、非大师本人观点。";

/** 大师视角的展开入口文案（标注 opt-in）。 */
export const MASTER_LENS_TOGGLE_LABEL = "换个大师视角看看（可选）";
