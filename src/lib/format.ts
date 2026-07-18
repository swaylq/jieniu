import type { EntityType, SourceTier } from "../../generated/prisma";

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  SECTOR: "板块",
  COMPANY: "公司",
  STOCK: "股票",
  PERSON: "人物",
};

export function entityTypeLabel(type: EntityType): string {
  return ENTITY_TYPE_LABEL[type];
}

export const SOURCE_TIER_LABEL: Record<SourceTier, string> = {
  PRIMARY: "一手",
  MEDIA: "媒体",
  DERIVED: "衍生",
};

export function sourceTierLabel(tier: SourceTier): string {
  return SOURCE_TIER_LABEL[tier];
}

/** 来源等级徽标的 Tailwind 类：一手=绿、媒体=灰、衍生=黄。 */
export function tierBadgeClass(tier: SourceTier): string {
  if (tier === "PRIMARY")
    return "rounded bg-green-100 px-1.5 py-0.5 text-green-700";
  if (tier === "MEDIA")
    return "rounded bg-gray-100 px-1.5 py-0.5 text-gray-600";
  return "rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-700";
}

/** 事件类型展示标签：少数关键词美化，其余原样返回（detectEventType 产出的关键词本就是中文）。 */
const EVENT_TYPE_LABEL: Record<string, string> = {
  处罚: "监管处罚",
  问询: "问询函",
  解禁: "限售解禁",
};

export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABEL[eventType] ?? eventType;
}

/** 相对时间："刚刚 / N分钟前 / N小时前 / 昨天 / N天前"，超过约 30 天回退为 YYYY-MM-DD。 */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const then = new Date(date);
  const sec = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 30) return `${day}天前`;
  const y = then.getFullYear();
  const m = String(then.getMonth() + 1).padStart(2, "0");
  const d = String(then.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 时间线锚点时间戳：当天显示 "HH:MM"，跨天显示 "MM-DD HH:MM"（电报流风格）。 */
export function streamStamp(date: Date, now: Date = new Date()): string {
  const then = new Date(date);
  const hh = String(then.getHours()).padStart(2, "0");
  const mm = String(then.getMinutes()).padStart(2, "0");
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) return `${hh}:${mm}`;
  const mo = String(then.getMonth() + 1).padStart(2, "0");
  const d = String(then.getDate()).padStart(2, "0");
  return `${mo}-${d} ${hh}:${mm}`;
}

const WATCH_TYPE_ORDER: Record<EntityType, number> = {
  SECTOR: 0,
  COMPANY: 1,
  STOCK: 2,
  PERSON: 3,
};

/** 侧栏关注列表排序：按类型(板块→公司→股票→人物)再按名称，不改原数组。 */
export function orderWatchEntities<T extends { name: string; type: EntityType }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const d = WATCH_TYPE_ORDER[a.type] - WATCH_TYPE_ORDER[b.type];
    if (d !== 0) return d;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
}

/** 命令面板键盘高亮 index：在 [0,len) 内环绕移动（↓ +1 / ↑ -1）；无结果返回 -1。 */
export function moveHighlight(cur: number, delta: number, len: number): number {
  if (len <= 0) return -1;
  return (((cur + delta) % len) + len) % len;
}

/** 把可能非法的时间值转成有效 Date；非法则回退（默认现在）。用于抓取源 publishedAt 兜底。 */
export function toValidDate(
  value: number | string | Date,
  fallback: Date = new Date(),
): Date {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** 登录 returnTo 安全校验：仅允许站内绝对路径，拒绝开放重定向（//、/\、含协议）。非法回退到 /。 */
export function safeReturnTo(path: string | null | undefined): string {
  if (typeof path !== "string") return "/";
  if (!path.startsWith("/")) return "/";
  if (path.startsWith("//") || path.startsWith("/\\")) return "/";
  return path;
}

/** 登录成功后的落地页：无明确来源（returnTo==="/"）的新登录先进引导 /onboarding，否则回来源页。 */
export function postLoginRedirect(returnTo: string): string {
  return returnTo === "/" ? "/onboarding" : returnTo;
}

/** 未读徽标文案：超过 99 显示 "99+"。 */
export function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** 通知是否未读：从未查看(水位线为空)或创建时间晚于上次查看水位线。 */
export function notificationUnread(createdAt: Date, seenAt: Date | null): boolean {
  return seenAt === null || createdAt.getTime() > seenAt.getTime();
}

/** 摘要与标题几乎重复时不必再显示（巨潮公告常 summary==title）。 */
export function summaryIsRedundant(title: string, summary: string): boolean {
  const t = title.trim();
  const s = summary.trim();
  if (s === "") return true;
  if (s === t) return true;
  if (t.startsWith(s)) return true;
  if (s.startsWith(t) && s.length - t.length <= 6) return true;
  return false;
}

/** 总市值（元）→ 人类可读（万亿/亿/万）。纯客观展示，非估值判断。无意义值返回「—」。 */
export function formatMarketCap(yuan: number | null): string {
  if (yuan === null || !Number.isFinite(yuan) || yuan <= 0) return "—";
  if (yuan >= 1e12) return `${(yuan / 1e12).toFixed(2)} 万亿`;
  if (yuan >= 1e8) {
    const yi = yuan / 1e8;
    return `${yi >= 100 ? Math.round(yi) : yi.toFixed(1)} 亿`;
  }
  if (yuan >= 1e4) return `${Math.round(yuan / 1e4)} 万`;
  return `${Math.round(yuan)} 元`;
}
