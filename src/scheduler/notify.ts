// 告警投递。稳态静默——只在任务 fail / timeout / skipped，或任一判据命中时发。
//
// 自带阿里 DirectMail 客户端（~25 行），不去改 src/server/alert-mailer.ts：
// 那是别的 session 也在动的共享文件，新逻辑一律开新文件。

import Core from "@alicloud/pop-core";
import type { Alert, JobStatus } from "./types";

/** 同一条任务两封告警信之间至少隔这么久，免得一个故障半夜刷屏。 */
export const THROTTLE_MS = 6 * 60 * 60 * 1000;

export function shouldNotify(x: {
  status: JobStatus;
  alertCount: number;
  lastNotifiedAtMs: number | null;
  nowMs: number;
}): boolean {
  const worth =
    x.status === "fail" ||
    x.status === "timeout" ||
    x.status === "skipped" ||
    x.alertCount > 0;
  if (!worth) return false;
  if (x.lastNotifiedAtMs === null) return true;
  return x.nowMs - x.lastNotifiedAtMs >= THROTTLE_MS;
}

function mailFrom(): string {
  return process.env.MAIL_FROM ?? "解牛 <noreply@mail.auramate.net>";
}
function senderAddress(): string {
  const f = mailFrom();
  return (/<([^>]+)>/.exec(f)?.[1] ?? f).trim();
}
function fromAlias(): string {
  return /^\s*([^<]+?)\s*</.exec(mailFrom())?.[1]?.trim() ?? "解牛";
}

let client: Core | null = null;
function getClient(): Core | null {
  const key = process.env.ALI_KEY;
  const secret = process.env.ALI_SECRET;
  if (!key || !secret) return null;
  const region = process.env.ALI_REGION ?? "cn-hangzhou";
  client ??= new Core({
    accessKeyId: key,
    accessKeySecret: secret,
    endpoint:
      region === "ap-southeast-1"
        ? "https://dm.ap-southeast-1.aliyuncs.com"
        : "https://dm.aliyuncs.com",
    apiVersion: "2015-11-23",
  });
  return client;
}

export type NotifyPayload = {
  jobKey: string;
  title: string;
  status: JobStatus;
  alerts: Alert[];
  narration: string | null;
  /** 已脱敏 */
  output: string;
  durationMs: number;
};

function renderHtml(p: NotifyPayload): string {
  const alertRows = p.alerts
    .map(
      (a) =>
        `<li><b>${a.id}</b>：${a.message}（实际 ${String(a.value)}，阈值 ${String(a.threshold)}）</li>`,
    )
    .join("");
  return [
    `<h2>解牛定时任务告警：${p.title}</h2>`,
    `<p>状态 <b>${p.status}</b>｜耗时 ${Math.round(p.durationMs / 1000)}s｜key <code>${p.jobKey}</code></p>`,
    p.narration ? `<p>${p.narration}</p>` : "",
    alertRows ? `<h3>命中的判据</h3><ul>${alertRows}</ul>` : "",
    `<h3>输出尾部</h3><pre style="white-space:pre-wrap;font-size:12px">${p.output.slice(-4000)}</pre>`,
  ].join("\n");
}

/** 返回是否真的发出去了。任何失败都只打日志，绝不影响任务状态。 */
export async function sendAlertMail(p: NotifyPayload): Promise<boolean> {
  const to = process.env.OPS_ALERT_EMAIL;
  if (!to) {
    console.error("[scheduler] 未设 OPS_ALERT_EMAIL —— 告警只落库，不发信");
    return false;
  }
  const c = getClient();
  if (!c) {
    console.error("[scheduler] 缺 ALI_KEY / ALI_SECRET —— 告警只落库，不发信");
    return false;
  }
  try {
    await c.request(
      "SingleSendMail",
      {
        RegionId: process.env.ALI_REGION ?? "cn-hangzhou",
        AccountName: senderAddress(),
        AddressType: 1,
        ReplyToAddress: false,
        ToAddress: to,
        Subject: `[解牛] ${p.title} ${p.status}${p.alerts.length ? ` · ${p.alerts.length} 项判据命中` : ""}`,
        FromAlias: fromAlias(),
        HtmlBody: renderHtml(p),
      },
      { method: "POST" },
    );
    return true;
  } catch (e) {
    console.error(
      "[scheduler] 告警信发送失败:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}
