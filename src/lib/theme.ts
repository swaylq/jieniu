export type Theme = "dark" | "light";

/** 决定初始主题：显式存储优先，否则跟随系统偏好。与 layout 无闪烁脚本逻辑一致。 */
export function resolveInitialTheme(
  stored: string | null,
  prefersDark: boolean,
): Theme {
  if (stored === "dark") return "dark";
  if (stored === "light") return "light";
  return prefersDark ? "dark" : "light";
}
