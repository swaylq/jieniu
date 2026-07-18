/**
 * 提醒协议（P5-8）——ChatGPT 批评：提醒该从「有新闻」升级成「有变化」，且可**按分类配置**、
 * 推送文案要带**理由**（帮你判断该不该行动），而不是又一条无差别新闻推送。
 *
 * 解牛已有维度状态跨越 alert（P4-8 thesisAlerts = 逻辑变化）与重磅资讯 alert；这里把它们做成
 * 可配置的分类协议，并为逻辑变化生成 hedged 的「该不该行动」理由。纯规则、零 AI、可测。
 * 价格类（自定义到价提醒 #3b）已随行情接入上线、可用；催化类随 P5-9 催化日历——暂标不可用、强制关。
 */
export type AlertCategory = "logic" | "fundamental" | "catalyst" | "price";

export type AlertPrefs = Record<AlertCategory, boolean>;

export const ALERT_CATEGORIES: {
  key: AlertCategory;
  label: string;
  desc: string;
  available: boolean;
  soon?: string;
}[] = [
  {
    key: "logic",
    label: "逻辑变化",
    desc: "你盯的投资命题维度发生方向跨越（中性 ↔ 偏兑现 / 偏风险）",
    available: true,
  },
  {
    key: "fundamental",
    label: "重磅资讯",
    desc: "自选股的高重要性公告与基本面动态",
    available: true,
  },
  {
    key: "catalyst",
    label: "催化事件",
    desc: "财报 / 解禁 / 股东会等日程节点临近",
    available: false,
    soon: "随催化日历（P5-9）推出",
  },
  {
    key: "price",
    label: "价格提醒",
    desc: "自定义到价提醒（涨破 / 跌破你设的价位）",
    available: true,
  },
];

export function defaultAlertPrefs(): AlertPrefs {
  return { logic: true, fundamental: true, catalyst: false, price: true };
}

/** 把存储的 JSON 归一成合法 prefs：填默认、丢未知键、**不可用分类强制 false**（无数据源不能开）。 */
export function normalizeAlertPrefs(raw: unknown): AlertPrefs {
  const out = defaultAlertPrefs();
  if (raw && typeof raw === "object") {
    for (const c of ALERT_CATEGORIES) {
      const v = (raw as Record<string, unknown>)[c.key];
      if (typeof v === "boolean") out[c.key] = v;
    }
  }
  for (const c of ALERT_CATEGORIES) {
    if (!c.available) out[c.key] = false;
  }
  return out;
}

/**
 * 逻辑变化 alert 的「该不该行动」理由——hedged、合规（不含买卖指令/点位/收益承诺），
 * 促自查而非指令。由维度跨越方向推导，纯规则。
 */
export function alertReason(a: { toState: string; dimensionKey: string }): string {
  const dim = a.dimensionKey;
  if (a.toState === "bearish") {
    return `「${dim}」转向偏风险。这是你盯的维度之一——建议对照你为它设的证伪条件，看是否已被触发；单条消息通常不改变长期逻辑，先看后续能否延续，别急着操作。`;
  }
  if (a.toState === "bullish") {
    return `「${dim}」转向偏兑现。你关注的逻辑出现向好信号——可留意后续是否持续验证，别仅凭单条消息追高。`;
  }
  return `「${dim}」方向回到中性，暂无明确增强或削弱，保持观察即可。`;
}
