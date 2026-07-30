/**
 * 品牌徽标几何 —— **单一事实源**。
 *
 * 徽标意象：金牛座 ♉ 的「锥形月角 + 头盘」。为什么不用具象牛头：具象牛头在 18px（侧栏 / favicon /
 * tab 条）尺寸下角与头会糊成一团花瓶状，而月角+圆盘是纯几何形，缩到 16px 仍认得出。同时
 * 「金牛」在 A 股语境里就是牛市，比一张牛脸更贴「私人投研工作台」的冷静气质。
 *
 * React 组件（`_components/logo.tsx`）与静态资产生成脚本（`scripts/gen-brand-assets.ts`）
 * 都从这里取几何，**任何一边都不许自己抄一份路径**，否则线上 UI 与 favicon / PWA 图标会分叉。
 */

/** 锥形月角：外弧 r=136 / 内弧 r=98，两端收成尖（根厚尖锐，像真牛角）。圆心 (256,144.5)。 */
export const MARK_CRESCENT =
  "M153 90 L128 98 A136 136 0 1 0 384 98 L359 90 L348 111 A98 98 0 1 1 164 111 Z";

/** 头盘：略扁的椭圆，顶部与月角外缘搭 6px，视觉上连成一体。 */
export const MARK_HEAD = { cx: 256, cy: 348.5, rx: 82, ry: 74 } as const;

/** 底板圆角（512 画布）。与 `rounded-2xl` 系的观感对齐。 */
export const PLATE_RX = 116;

export const BRAND_AMBER = "#f5a623";

/** 底板纯色。 */
export const PLATE_SOLID = "#14181f";

/** 描边环透明度（底板与背景之间的边界感，深浅背景通吃）。 */
export const RING_OPACITY = ".28";

/**
 * 生成完整徽标 SVG 字符串（静态资产生成脚本用；React 侧是 `_components/logo.tsx` 的 JSX 版）。
 *
 * **两边必须逐像素一致** —— favicon / PWA 图标 / OG 图与站内 logo 是同一个东西，不许一边渐变
 * 一边纯色（sway 明确要求）。所以这里也只用纯色：一是与组件对齐，二是组件那边本来就不能用
 * `url(#gradientId)`（同名 defs 只解析文档序最前那个，而桌面侧栏在移动端是 `display:none`，
 * 引用解析失败 → 徽标渲染成空方框，已踩）。改色只改上面那两个常量，两边同时生效。
 *
 * - `bleed`：满幅无圆角、无描边环 —— PWA maskable 图标要求（系统会自行裁形）。
 * - `glyphScale`：字形缩放（maskable 安全区留白用）。
 */
export function brandMarkSvg({
  size = 512,
  bleed = false,
  glyphScale = 1,
}: {
  size?: number;
  bleed?: boolean;
  glyphScale?: number;
} = {}): string {
  const rx = bleed ? 0 : PLATE_RX;
  const ring = bleed
    ? ""
    : `<rect x="5" y="5" width="502" height="502" rx="${PLATE_RX - 5}" fill="none" stroke="${BRAND_AMBER}" stroke-opacity="${RING_OPACITY}" stroke-width="4"/>`;
  const glyph =
    `<path d="${MARK_CRESCENT}" fill="${BRAND_AMBER}"/>` +
    `<ellipse cx="${MARK_HEAD.cx}" cy="${MARK_HEAD.cy}" rx="${MARK_HEAD.rx}" ry="${MARK_HEAD.ry}" fill="${BRAND_AMBER}"/>`;
  const glyphWrapped =
    glyphScale === 1
      ? glyph
      : `<g transform="translate(256 256) scale(${glyphScale}) translate(-256 -256)">${glyph}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" role="img" aria-label="解牛">
  <rect width="512" height="512" rx="${rx}" fill="${PLATE_SOLID}"/>
  ${ring}
  ${glyphWrapped}
</svg>`;
}

/**
 * 用户默认头像的渐变色板：由邮箱稳定散列取一组，同一用户永远同色。
 * 全部选深色调 —— 白字在每个「浅端」色上都 ≥5.5:1（WCAG AA）。
 */
export const AVATAR_GRADIENTS: readonly (readonly [string, string])[] = [
  ["#3b5bdb", "#5f3dc4"], // 靛 → 紫
  ["#0b7285", "#155e75"], // 青 → 深蓝青
  ["#9c36b5", "#6d28d9"], // 品红 → 紫
  ["#475569", "#1e293b"], // 石板灰
  ["#0f766e", "#115e59"], // 深松绿
  ["#be185d", "#86198f"], // 玫红 → 梅
];

/** 稳定散列 → 头像渐变。同一 seed（邮箱 / userId）永远同一组色。 */
export function avatarGradient(seed: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]!;
}

/** 头像首字母：邮箱取首字符大写；空值回退「解」。 */
export function avatarInitial(seed: string | null | undefined): string {
  const s = (seed ?? "").trim();
  if (!s) return "解";
  return s[0]!.toUpperCase();
}
