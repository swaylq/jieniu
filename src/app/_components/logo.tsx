import {
  BRAND_AMBER,
  MARK_CRESCENT,
  MARK_HEAD,
  PLATE_SOLID,
  PLATE_RX,
  RING_OPACITY,
} from "~/lib/brand";

/**
 * 解牛品牌徽标（金牛座意象：琥珀锥形月角 + 头盘 · 深底板 + 琥珀发丝环）。
 *
 * **全 App 唯一的徽标**：侧栏品牌块、移动端顶栏、登录 / 我的组合 / 设置，以及 favicon、PWA
 * 图标、OG 图全部是这一个形——不要再写 emoji、不要再拿「牛」字方块顶替（那是旧侧栏的做法，
 * 已下线）。几何在 `~/lib/brand`，静态资产由 `scripts/gen-brand-assets.ts` 从同一份几何生成。
 *
 * 颜色 / 圆角 / 描边环透明度全部取自 `~/lib/brand` 的常量，**与 favicon、PWA 图标、OG 图逐像素
 * 一致**（同一份几何 + 同一份纯色）。
 *
 * **这里刻意用纯色，不用 `<linearGradient>` + `url(#id)`** —— 踩过：同一文档多个实例定义同名
 * defs 时，`url(#id)` 只解析到文档序最前那个；而桌面侧栏在移动端是 `hidden`（`display:none`），
 * 不进渲染树 → 它的渐变解析不出来 → 移动端顶栏徽标渲染成一个空方框。纯色自足、任何挂载位置都对。
 */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="解牛">
      <rect width="512" height="512" rx={PLATE_RX} fill={PLATE_SOLID} />
      <rect
        x="5"
        y="5"
        width="502"
        height="502"
        rx={PLATE_RX - 5}
        fill="none"
        stroke={BRAND_AMBER}
        strokeOpacity={RING_OPACITY}
        strokeWidth="4"
      />
      <path d={MARK_CRESCENT} fill={BRAND_AMBER} />
      <ellipse
        cx={MARK_HEAD.cx}
        cy={MARK_HEAD.cy}
        rx={MARK_HEAD.rx}
        ry={MARK_HEAD.ry}
        fill={BRAND_AMBER}
      />
    </svg>
  );
}

/** 徽标 + 字标（移动端顶栏用）。 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark className="h-7 w-7" />
      <span className="text-lg font-extrabold tracking-tight text-ink">
        解牛
      </span>
    </span>
  );
}
