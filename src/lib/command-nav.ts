export type NavCommand = { label: string; sub: string; href: string; keys: string };

/** ⌘K 快捷前往命令（keys 含拼音/英文助记，方便快速跳转）。 */
export const NAV_COMMANDS: NavCommand[] = [
  { label: "今日变化", sub: "投资晨报 · 组合动态", href: "/", keys: "home sy shouye jrbh jinri" },
  { label: "机会雷达", sub: "近 3 天热度 × 新信息", href: "/discover", keys: "opportunity discover jh jihui radar fx faxian" },
  { label: "自选", sub: "你的自选股动态流", href: "/feed", keys: "watchlist follow feed zx zixuan gz guanzhu" },
  { label: "提醒中心", sub: "逻辑异动 · 重磅资讯", href: "/notifications", keys: "notify alert tx tixing tz tongzhi" },
  { label: "我的组合", sub: "持仓 / 决策 / 画像", href: "/profile", keys: "portfolio me wd wode profile zuhe" },
];

/** 按 label（子串）或助记 keys（按空格分词、逐词前缀）过滤命令；空查询返回全部（启动器默认项）。 */
export function matchNav(query: string): NavCommand[] {
  const raw = query.trim();
  if (raw === "") return NAV_COMMANDS;
  const s = raw.toLowerCase();
  return NAV_COMMANDS.filter(
    (n) => n.label.includes(raw) || n.keys.split(" ").some((k) => k.startsWith(s)),
  );
}
