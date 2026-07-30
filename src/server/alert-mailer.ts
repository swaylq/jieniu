// 提醒邮件投递。相对导入 + 直读 process.env，**tsx 安全**——不能走 ~/env（cron 用 tsx，别名不解析，
// 且 @t3-oss/env-nextjs 在脚本环境里会跑 Next 侧校验）。
//
// 密钥（ALI_KEY / ALI_SECRET）只在 secret store，靠 `secret exec` 注入。缺了就打日志返回 false，
// **绝不裸 catch**：密钥缺失型故障是静默的，吞掉错因等于把唯一线索删了（7-24 事故）。

import Core from "@alicloud/pop-core";

import type { PrismaClient } from "../../generated/prisma";
import {
  selectForDelivery,
  withinQuietHours,
  type AlertKind,
} from "../lib/alert-outbox";
import {
  alertEmailSubject,
  renderAlertEmailHtml,
  type MailItem,
  type MailBrief,
  type MailUserBrief,
} from "../lib/alert-email";
import {
  tradeDateOf,
  normalizeDrivers,
  type MarketDigestData,
} from "../lib/market-digest";
import type { UserDigestData } from "../lib/user-digest";

const DEFAULT_BASE_URL = "https://jieniu.swaylab.ai";
const DEFAULT_MAIL_FROM = "解牛 <noreply@mail.auramate.net>";
/** 只投递近 N 小时内发生的事实——隔夜没跑的补一次，但不翻旧账。 */
export const MAIL_WINDOW_HOURS = 48;

export function baseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? DEFAULT_BASE_URL;
}

function mailFrom(): string {
  return process.env.MAIL_FROM ?? DEFAULT_MAIL_FROM;
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

async function send(to: string, subject: string, html: string): Promise<boolean> {
  const c = getClient();
  if (!c) {
    console.error(
      "[alert-mail] 缺 ALI_KEY / ALI_SECRET —— cron 必须用 `secret exec ALI_KEY ALI_SECRET -- …` 起",
    );
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
        Subject: subject,
        FromAlias: fromAlias(),
        HtmlBody: html,
      },
      { method: "POST" },
    );
    return true;
  } catch (e) {
    console.error(
      "[alert-mail] Aliyun DirectMail 发送失败:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}

export type MailStats = {
  candidates: number;
  sent: number;
  failed: number;
  skippedQuiet: boolean;
};

type MailerDb = Pick<PrismaClient, "user" | "alertEvent" | "marketDigest" | "userDigest">;

/**
 * 取当日复盘。**只认当天**——昨天的复盘发出去比不发更糟（读者会以为是今天的）。
 * 取不到就返回 null，信照发（只是没有复盘段）。
 */
async function todaysBrief(db: MailerDb, now: Date): Promise<MailBrief | null> {
  const tradeDate = tradeDateOf(now);
  const d = await db.marketDigest.findUnique({
    where: { tradeDate_market: { tradeDate, market: "CN" } },
  });
  if (!d) return null;
  const sectors = (d.sectors ?? { strong: [], weak: [] }) as MarketDigestData["sectors"];
  return {
    tradeDate: d.tradeDate,
    data: {
      overview: d.overview,
      drivers: normalizeDrivers(d.drivers),
      sectors: { strong: sectors.strong ?? [], weak: sectors.weak ?? [] },
      stocks: (d.stocks ?? []) as MarketDigestData["stocks"],
      watchpoints: (d.watchpoints ?? []) as string[],
      judgment: d.judgment,
      breadth: (d.stats ?? null) as MarketDigestData["breadth"],
    },
  };
}

/** 取某人当日的个人复盘。同样**只认当天**——昨天的组合复盘发出去会被当成今天的。 */
async function usersBrief(
  db: MailerDb,
  userId: string,
  now: Date,
): Promise<MailUserBrief | null> {
  const tradeDate = tradeDateOf(now);
  const d = await db.userDigest.findUnique({
    where: { userId_tradeDate_market: { userId, tradeDate, market: "CN" } },
  });
  if (!d) return null;
  return {
    tradeDate: d.tradeDate,
    data: {
      headline: d.headline,
      portfolio: d.portfolio as unknown as UserDigestData["portfolio"],
      exposure: d.exposure as unknown as UserDigestData["exposure"],
      touched: d.touched as unknown as UserDigestData["touched"],
      watchpoints: (d.watchpoints ?? []) as string[],
      judgment: d.judgment,
    },
  };
}

/**
 * 给开了邮件投递的用户各发一封异动邮件。
 * - 只取 offsite=true 且未投递过的事件（emailedAt=null），近 MAIL_WINDOW_HOURS 小时内发生
 * - 一封最多 DELIVERY_MAX_ITEMS 条，其余在信里写明「另有 N 条在站内」
 * - **候选全体**（投出去的 + 被挤下去的）都标 emailedAt：它们已经在这封信里被交代过了，
 *   否则下一封会把同一批再报一遍
 */
export async function sendAlertEmails(
  db: MailerDb,
  opts: { now?: Date; dryRun?: boolean; userIds?: string[] } = {},
): Promise<MailStats> {
  const now = opts.now ?? new Date();
  const stats: MailStats = {
    candidates: 0,
    sent: 0,
    failed: 0,
    skippedQuiet: false,
  };

  if (withinQuietHours(now)) {
    stats.skippedQuiet = true;
    console.log("[alert-mail] 免打扰时段（22:00–07:30），本轮不投递");
    return stats;
  }

  const since = new Date(now.getTime() - MAIL_WINDOW_HOURS * 60 * 60 * 1000);
  // 复盘是这封信的骨架——**每日都有**，所以即使一条自选异动都没有也照发。
  const brief = await todaysBrief(db, now);
  const users = await db.user.findMany({
    where: {
      alertEmail: true,
      email: { not: null },
      ...(opts.userIds ? { id: { in: opts.userIds } } : {}),
    },
    select: { id: true, email: true, alertEmailToken: true },
  });

  for (const u of users) {
    if (!u.email) continue;
    const events = await db.alertEvent.findMany({
      where: {
        userId: u.id,
        offsite: true,
        emailedAt: null,
        occurredAt: { gte: since },
      },
      orderBy: [{ priority: "desc" }, { occurredAt: "desc" }],
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        url: true,
        occurredAt: true,
        priority: true,
        offsite: true,
      },
    });
    stats.candidates += events.length;

    const userBrief = await usersBrief(db, u.id, now);
    const { deliver, heldBack } = selectForDelivery(events);
    // 三者皆无才跳过；只要有任一份复盘就发（每日都有是产品承诺）
    if (deliver.length === 0 && !brief && !userBrief) continue;

    const items: MailItem[] = deliver.map((e) => ({
      kind: e.kind as AlertKind,
      title: e.title,
      body: e.body,
      url: e.url,
      occurredAt: e.occurredAt,
    }));
    const subject = alertEmailSubject(items, userBrief ?? brief);
    const html = renderAlertEmailHtml({
      items,
      heldBack,
      baseUrl: baseUrl(),
      unsubUrl: `${baseUrl()}/unsubscribe?t=${encodeURIComponent(u.alertEmailToken ?? "")}`,
      brief,
      userBrief,
    });

    if (opts.dryRun) {
      console.log(
        `[alert-mail] (dry) → ${u.email}｜个人复盘 ${userBrief ? "有" : "无"}｜市场复盘 ${brief ? "有" : "无"}｜${deliver.length} 条 + 压 ${heldBack} 条｜${subject}`,
      );
      stats.sent++;
      continue;
    }

    const ok = await send(u.email, subject, html);
    if (ok) {
      // 候选全体标已投递：被挤下去的那些已在信里以「另有 N 条」交代过
      await db.alertEvent.updateMany({
        where: { id: { in: events.map((e) => e.id) } },
        data: { emailedAt: now },
      });
      stats.sent++;
      console.log(
        `[alert-mail] → ${u.email}｜个人复盘 ${userBrief ? "有" : "无"}｜市场复盘 ${brief ? "有" : "无"}｜投 ${deliver.length} 条，压 ${heldBack} 条`,
      );
    } else {
      stats.failed++;
    }
  }
  return stats;
}
