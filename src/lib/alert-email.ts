// 异动邮件的纯渲染逻辑（无 IO，可测）。相对导入（cron 走 tsx，不解析 ~）。
//
// 三条硬要求：① 标题/正文来自外部源，必须转义；② 被挤下去的条数要写明，不静默截断；
// ③ 必须带退订链接（合规）。文案沿用提醒协议的 hedged 口径，不含买卖指令。

import type { AlertKind } from "./alert-outbox";
import type { MarketDigestData } from "./market-digest";
import { SCOPE_LABEL, type DigestScope, type MarketBreadth } from "./digest-substance";
import type { UserDigestData } from "./user-digest";

export type MailItem = {
  kind: AlertKind;
  title: string;
  body: string;
  url: string | null;
  occurredAt: Date;
};

export type MailBrief = {
  tradeDate: string;
  data: MarketDigestData;
};

/** 个人复盘段——贴着这位收信人的组合写的那份，排在市场复盘之前。 */
export type MailUserBrief = {
  tradeDate: string;
  data: UserDigestData;
};

const SUBJECT_PREFIX = "【解牛】";
const SUBJECT_MAX = 48;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * 主题行。有复盘时以复盘为主体（每日都有，是这封信的骨架），自选股异动作为附注；
 * 没有复盘时退回「首条 等 N 条」。计数诚实，不夸大。两者都没有返回空串——调用方据此不发信。
 */
export function alertEmailSubject(
  items: { title: string }[],
  brief?: { tradeDate: string } | null,
): string {
  if (brief) {
    const md = brief.tradeDate.slice(5).replace("-", ".");
    const suffix = items.length > 0 ? ` · 自选 ${items.length} 条异动` : "";
    return `${SUBJECT_PREFIX}今日复盘 ${md}${suffix}`;
  }
  if (items.length === 0) return "";
  const head = items[0]!.title;
  if (items.length === 1) return clamp(`${SUBJECT_PREFIX}${head}`, SUBJECT_MAX);
  const suffix = ` 等 ${items.length} 条`;
  return `${clamp(`${SUBJECT_PREFIX}${head}`, SUBJECT_MAX - suffix.length)}${suffix}`;
}

const KIND_LABEL: Record<AlertKind, string> = {
  logic: "逻辑异动",
  fundamental: "重磅资讯",
  price: "到价提醒",
};

const KIND_COLOR: Record<AlertKind, string> = {
  logic: "#b45309",
  fundamental: "#475569",
  price: "#0f766e",
};

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderItem(it: MailItem, baseUrl: string): string {
  const href = it.url ? escapeHtml(`${baseUrl}${it.url}`) : "";
  const title = escapeHtml(it.title);
  const titleHtml = href
    ? `<a href="${href}" style="color:#0f172a;text-decoration:none">${title}</a>`
    : title;
  const body = escapeHtml(it.body).replace(/\n/g, "<br>");
  return `
    <div style="padding:16px 0;border-bottom:1px solid #e8e3da">
      <div style="font-size:12px;color:${KIND_COLOR[it.kind]};letter-spacing:.05em">
        ${KIND_LABEL[it.kind]} · ${stamp(it.occurredAt)}
      </div>
      <div style="margin-top:6px;font-size:16px;font-weight:600;line-height:1.5;color:#0f172a">
        ${titleHtml}
      </div>
      ${body ? `<div style="margin-top:8px;font-size:14px;line-height:1.7;color:#475569">${body}</div>` : ""}
    </div>`;
}

function bullets(items: string[]): string {
  if (items.length === 0) return "";
  return `<ul style="margin:6px 0 0;padding-left:18px">${items
    .map(
      (t) =>
        `<li style="font-size:13px;line-height:1.75;color:#475569">${escapeHtml(t)}</li>`,
    )
    .join("")}</ul>`;
}

function briefSection(n: number, title: string, inner: string): string {
  if (!inner) return "";
  return `<div style="margin-top:14px">
    <div style="font-size:13px;font-weight:700;color:#0f172a">
      <span style="color:#b45309">${n}</span> ${escapeHtml(title)}
    </div>${inner}
  </div>`;
}

/** 核心驱动按「国际 / 国内 / 产业」三层铺开——与首屏同构（2026-07-29 改版）。 */
function driverGroups(drivers: MailBrief["data"]["drivers"]): string {
  const scopes: DigestScope[] = ["overseas", "domestic", "industry"];
  return scopes
    .map((s) => {
      const items = drivers.filter((d) => d.scope === s).map((d) => d.text);
      if (items.length === 0) return "";
      return `<div style="margin-top:8px">
        <div style="font-size:11px;font-weight:700;letter-spacing:.05em;color:#b45309">${SCOPE_LABEL[s]}</div>
        ${bullets(items)}
      </div>`;
    })
    .join("");
}

/** 市场宽度一行：指数会骗人，涨跌家数才是「今天什么盘」，而且它每天都不一样。 */
function breadthLine(b: MarketBreadth | null): string {
  if (!b) return "";
  const med =
    b.medianChangePct === null
      ? "—"
      : `${b.medianChangePct >= 0 ? "+" : ""}${b.medianChangePct.toFixed(2)}%`;
  return `<div style="margin-top:10px;padding:8px 12px;border:1px solid #e8e3da;border-radius:8px;font-size:12px;line-height:1.7;color:#475569;font-variant-numeric:tabular-nums">
    上涨 <b style="color:#0f172a">${b.up}</b> / 下跌 <b style="color:#0f172a">${b.down}</b>
    · 涨停 <b style="color:#0f172a">${b.limitUp}</b> / 跌停 <b style="color:#0f172a">${b.limitDown}</b>
    · 个股中位 <b style="color:#0f172a">${med}</b>
    <span style="color:#94a3b8">（样本 ${b.counted} 只）</span>
  </div>`;
}

/** 每日复盘段——整封信的主体。判断段单独高亮，它是「读新闻」变成「知道明天看什么」的落点。 */
function renderBrief(b: MailBrief): string {
  const d = b.data;
  const sectorLis = [
    ...d.sectors.strong.map(
      (s) =>
        `<li style="font-size:13px;line-height:1.75;color:#475569"><b style="color:#b45309">强</b> ${escapeHtml(s.name)}${s.note ? ` · ${escapeHtml(s.note)}` : ""}</li>`,
    ),
    ...d.sectors.weak.map(
      (s) =>
        `<li style="font-size:13px;line-height:1.75;color:#475569"><b style="color:#94a3b8">弱</b> ${escapeHtml(s.name)}${s.note ? ` · ${escapeHtml(s.note)}` : ""}</li>`,
    ),
  ].join("");
  const stockLis = d.stocks
    .map(
      (s) =>
        `<li style="font-size:13px;line-height:1.75;color:#475569"><b style="color:#0f172a">${escapeHtml(s.name)}</b>${
          s.changePct === null
            ? ""
            : ` <span style="font-variant-numeric:tabular-nums">${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(2)}%</span>`
        }${s.note ? ` · ${escapeHtml(s.note)}` : ""}</li>`,
    )
    .join("");
  const wrap = (lis: string) =>
    lis ? `<ul style="margin:6px 0 0;padding-left:18px">${lis}</ul>` : "";

  return `<div style="padding:4px 0 18px;border-bottom:1px solid #e8e3da">
    <div style="font-size:15px;font-weight:700;color:#0f172a">今日复盘 · ${escapeHtml(b.tradeDate)}</div>
    <div style="margin-top:8px;font-size:14px;line-height:1.75;color:#334155">${escapeHtml(d.overview)}</div>
    ${breadthLine(d.breadth)}
    <div style="margin-top:12px;padding:12px 14px;border:1px solid rgba(180,83,9,.3);border-radius:10px;background:rgba(180,83,9,.04)">
      <div style="font-size:11px;font-weight:700;letter-spacing:.05em;color:#b45309">判断</div>
      <div style="margin-top:4px;font-size:13px;line-height:1.75;color:#334155">${escapeHtml(d.judgment)}</div>
    </div>
    ${briefSection(2, "今日核心驱动", driverGroups(d.drivers))}
    ${briefSection(3, "强弱板块", wrap(sectorLis))}
    ${briefSection(4, "重点个股", wrap(stockLis))}
    ${briefSection(5, "下一交易日关注点", bullets(d.watchpoints))}
  </div>`;
}

function pct(v: number): string {
  return `<span style="font-variant-numeric:tabular-nums">${v >= 0 ? "+" : ""}${v.toFixed(2)}%</span>`;
}

/** 个人复盘段。数字全部来自服务端计算（模型不产出数值）。 */
function renderUserBrief(b: MailUserBrief): string {
  const d = b.data;
  const p = d.portfolio;
  const stat = [
    `共 ${p.total} 只`,
    p.held > 0 ? `持仓 ${p.held}` : "",
    p.quoted > 0 ? `今日涨 ${p.up} 跌 ${p.down}` : "今日暂无行情",
    p.avgChangePct !== null ? `${p.weighted ? "按仓位加权" : "均值"} ${pct(p.avgChangePct)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const movers = p.movers
    .map(
      (m) =>
        `<li style="font-size:13px;line-height:1.75;color:#475569"><span style="font-size:11px;color:${m.held ? "#b45309" : "#94a3b8"}">${m.held ? "持仓" : "观察"}</span> <b style="color:#0f172a">${escapeHtml(m.name)}</b> ${pct(m.changePct)}${m.note ? ` · ${escapeHtml(m.note)}` : ""}</li>`,
    )
    .join("");
  const exposure = d.exposure
    .map(
      (e) =>
        `<li style="font-size:13px;line-height:1.75;color:#475569"><b style="color:#0f172a">${escapeHtml(e.sector)}</b> ${pct(e.sectorChangePct)}（${escapeHtml(e.signal)}）· 你有 ${escapeHtml(e.stocks.join("、"))}${e.note ? `<br><span style="color:#64748b">${escapeHtml(e.note)}</span>` : ""}</li>`,
    )
    .join("");
  const touched = d.touched
    .map(
      (t) =>
        `<li style="font-size:13px;line-height:1.75;color:#475569"><b style="color:#0f172a">${escapeHtml(t.entityName)}</b>「${escapeHtml(t.dimensionKey)}」${escapeHtml(t.fromState)} → ${escapeHtml(t.toState)}</li>`,
    )
    .join("");
  const wrap = (lis: string) =>
    lis ? `<ul style="margin:6px 0 0;padding-left:18px">${lis}</ul>` : "";

  return `<div style="padding:4px 0 18px;border-bottom:1px solid #e8e3da">
    <div style="font-size:15px;font-weight:700;color:#0f172a">${escapeHtml(d.headline)}</div>
    <div style="margin-top:6px;font-size:12px;color:#64748b">${stat}</div>
    <div style="margin-top:12px;padding:12px 14px;border:1px solid rgba(180,83,9,.3);border-radius:10px;background:rgba(180,83,9,.04)">
      <div style="font-size:11px;font-weight:700;letter-spacing:.05em;color:#b45309">对你的判断</div>
      <div style="margin-top:4px;font-size:13px;line-height:1.75;color:#334155">${escapeHtml(d.judgment)}</div>
    </div>
    ${briefSection(1, "你的标的今天", wrap(movers))}
    ${briefSection(2, "你的板块暴露", wrap(exposure))}
    ${briefSection(3, "触及你的投资逻辑", wrap(touched))}
    ${briefSection(4, "明天你要看什么", bullets(d.watchpoints))}
  </div>`;
}

/** 渲染整封信。heldBack>0 时写明「另有 N 条在站内」并给出提醒中心入口。 */
export function renderAlertEmailHtml(input: {
  items: MailItem[];
  heldBack: number;
  baseUrl: string;
  unsubUrl: string;
  brief?: MailBrief | null;
  userBrief?: MailUserBrief | null;
}): string {
  const { items, heldBack, baseUrl, unsubUrl, brief, userBrief } = input;
  const inbox = escapeHtml(`${baseUrl}/notifications`);
  const more =
    heldBack > 0
      ? `<div style="padding:14px 0;font-size:13px;color:#64748b">
           另有 ${heldBack} 条未列出，在
           <a href="${inbox}" style="color:#b45309">提醒中心</a> 查看。
         </div>`
      : "";
  return `<div style="margin:0;padding:24px 12px;background:#faf7f2">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e8e3da;border-radius:14px;padding:24px;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
    <div style="font-size:13px;color:#b45309;font-weight:600;letter-spacing:.08em">解牛 · 每日复盘</div>
    <div style="margin-top:4px;margin-bottom:10px;font-size:13px;color:#64748b">今日市场发生了什么，明天该看什么</div>
    ${userBrief ? renderUserBrief(userBrief) : ""}
    ${brief ? `<div style="margin-top:16px;font-size:12px;color:#94a3b8">以下为市场背景</div>${renderBrief(brief)}` : ""}
    ${items.length > 0 ? `<div style="margin-top:16px;font-size:13px;font-weight:700;color:#0f172a">你的自选股</div>` : ""}
    ${items.map((it) => renderItem(it, baseUrl)).join("")}
    ${more}
    <div style="margin-top:20px">
      <a href="${inbox}" style="display:inline-block;padding:10px 18px;background:#b45309;color:#fff;border-radius:9px;font-size:14px;text-decoration:none">打开提醒中心</a>
    </div>
    <div style="margin-top:20px;padding-top:14px;border-top:1px solid #e8e3da;font-size:12px;line-height:1.7;color:#94a3b8">
      以上为客观事实与规则提示，不构成投资建议，不含买卖指令或目标价。<br>
      不想再收到这类邮件？<a href="${escapeHtml(unsubUrl)}" style="color:#94a3b8">退订</a>
    </div>
  </div>
</div>`;
}
