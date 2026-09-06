/**
 * 导航语义（P5-13）——主导航的**单一来源**（sidebar 桌面栏 + tab-bar 移动栏共用）。
 *
 * 语义校准（对齐产品定位「自选股投资逻辑监控 Agent」）：
 * - 「关注」→「自选」：解牛盯的是你的**自选股**（首页 hero 早已叫「我的自选股」），
 *   "关注" 太像社交订阅、语义太轻；"自选"（自选股）是 A 股标准说法、契合监控模型。
 * - 「发现」→「机会」：P5-4 已把发现页重做成**机会雷达**打头（答 ChatGPT「发现页最弱」），
 *   直接给一个「机会」入口，无需新增第 5 个 tab、路由不变。
 * - 「通知」移出主导航 → 独立**提醒中心**：移动端本就在顶栏右上角（bell），桌面端放侧栏顶部。
 *
 * 路由全部不变（/feed、/discover、/notifications 照旧），只动语义标签与通知的摆放，低风险。
 * icon 用字符串键，组件侧映射到 `icons.tsx` 的组件——保持本模块纯、可测、无 JSX。
 */

export type NavIconKey = "home" | "compass" | "star" | "user" | "bell";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconKey;
  /** 移动端 tab-bar 用的短标签（省空间）。 */
  short?: string;
};

/** 主导航（4 项 · 私人投研工作台语义）：今日变化 / 机会雷达 / 自选 / 我的组合。 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "今日变化", icon: "home", short: "今日" },
  { href: "/discover", label: "机会雷达", icon: "compass", short: "机会" },
  { href: "/feed", label: "自选", icon: "star", short: "自选" },
  { href: "/profile", label: "我的组合", icon: "user", short: "组合" },
];

/** 提醒中心：桌面进侧栏工作台导航（末位），移动端在顶栏右上角。 */
export const NOTIFICATION_NAV: NavItem = {
  href: "/notifications",
  label: "提醒中心",
  icon: "bell",
  short: "提醒",
};

/**
 * 国际版入口（美股英文站）。它是**另一个站点**——独立仓库、独立数据库、独立域名，
 * 所以是外链而不是路由：不进 `PRIMARY_NAV`（那几项都走客户端路由、都要参与 active 判定），
 * 也不占移动端 tab-bar 的格子（4 个已经排满，挤第 5 个会把标签压到看不清）。
 * 入口只挂两处：桌面侧栏底部、移动端顶栏右上角。
 */
export const INTERNATIONAL_SITE = {
  href: "https://jieniu-en.swaylab.ai/",
  label: "International",
  /** 读屏与悬停提示：只给一个英文单词的话，没人知道点过去是什么。 */
  title: "International — 美股英文站（新标签页打开）",
} as const;

/** 当前路径是否命中该导航项：首页只认精确 `/`，其余按前缀。 */
export function isNavActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
