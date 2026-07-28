import type { PrismaClient } from "../../../generated/prisma";
import {
  parseAppointment,
  formatLocalDay,
  type AppointRow,
  type Appointment,
} from "../../lib/disclosure";

/**
 * 定期报告预约披露日 → `EntitySignal(kind="disclosure")`。
 *
 * 借鉴富途「牛牛财报站」的财报倒计时。解牛此前只能给法定最晚披露日（年报 4/30 等），
 * 对个股毫无信息量；交易所预约披露时间表是公司报备的确定性日程，精确到天。
 *
 * 落库选型：复用 `EntitySignal`（每股每 kind 一行 upsert），**零 schema 迁移**——
 * 迁移历史上踩过 `db push` 与迁移文件分叉的坑，能不动 schema 就不动。
 *
 * 相对导入（不用 `~` 别名）：让 `src/scripts/*.ts` 走 tsx 也能引用（tsx 不解析 tsconfig paths）。
 */

const API = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * 存进 `EntitySignal.detail` 的结构。日期存本地 `YYYY-MM-DD`（不是 ISO 时刻）——
 * 披露日是日历日；`toISOString()` 会把本地 8/15 写成 `2026-08-14T16:00Z`，掉一天。
 * 倒计时交给渲染时算，不存进 label（存了隔天就过期）。
 */
export type DisclosureDetail = {
  reportKey: string;
  periodLabel: string;
  date: string; // YYYY-MM-DD（本地日历日）
  rescheduled: boolean;
};

export type DisclosureSignalUpsert = {
  kind: "disclosure";
  label: string;
  numValue: number | null;
  detail: DisclosureDetail;
  asOf: Date;
};

function mmdd(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 待披露的预约日 → 信号载荷。已实际披露的返回 null（倒计时只给未来）。
 * label 里刻意**不写「还有 N 天」**：这行会存进库，隔天就是错的。
 */
export function disclosureSignal(
  appt: Appointment,
  now: Date = new Date(),
): DisclosureSignalUpsert | null {
  if (appt.actual) return null;
  const suffix = appt.rescheduled ? " · 已改期" : "";
  return {
    kind: "disclosure",
    label: `${appt.periodLabel} · 预约 ${mmdd(appt.date)} 披露${suffix}`,
    numValue: appt.daysUntil,
    detail: {
      reportKey: appt.reportKey,
      periodLabel: appt.periodLabel,
      date: formatLocalDay(appt.date),
      rescheduled: appt.rescheduled,
    },
    asOf: now,
  };
}

const COLUMNS = [
  "SECURITY_CODE",
  "SECURITY_NAME_ABBR",
  "REPORT_TYPE",
  "REPORT_YEAR",
  "REPORT_DATE",
  "FIRST_APPOINT_DATE",
  "FIRST_CHANGE_DATE",
  "SECOND_CHANGE_DATE",
  "THIRD_CHANGE_DATE",
  "ACTUAL_PUBLISH_DATE",
].join(",");

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchPage(
  from: string,
  to: string,
  page: number,
): Promise<{ rows: AppointRow[]; pages: number }> {
  const filter = encodeURIComponent(
    `(FIRST_APPOINT_DATE>='${from}')(FIRST_APPOINT_DATE<='${to}')`,
  );
  const url =
    `${API}?reportName=RPT_PUBLIC_BS_APPOIN&columns=${COLUMNS}` +
    `&pageNumber=${page}&pageSize=500&sortColumns=FIRST_APPOINT_DATE&sortTypes=1&filter=${filter}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RPT_PUBLIC_BS_APPOIN ${res.status}`);
  const j = (await res.json()) as {
    result?: { data?: AppointRow[]; pages?: number };
  };
  return { rows: j.result?.data ?? [], pages: j.result?.pages ?? 1 };
}

/** 拉取某股全部预约披露记录（含历史实际披露日）。供财报页按需取历史样本。 */
export async function fetchStockAppointments(
  code: string,
): Promise<AppointRow[]> {
  const filter = encodeURIComponent(`(SECURITY_CODE="${code}")`);
  const url =
    `${API}?reportName=RPT_PUBLIC_BS_APPOIN&columns=${COLUMNS}` +
    `&pageNumber=1&pageSize=40&sortColumns=REPORT_DATE&sortTypes=-1&filter=${filter}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RPT_PUBLIC_BS_APPOIN ${res.status}`);
  const j = (await res.json()) as { result?: { data?: AppointRow[] } };
  return j.result?.data ?? [];
}

/**
 * 全市场扫一遍未来 `horizonDays` 天的预约披露日，写进覆盖池内个股的 `EntitySignal`。
 * 同一只股同时有多期待披露时只留**最近**那一期（倒计时只需要下一个节点）。
 */
export async function populateDisclosures(
  db: PrismaClient,
  now: Date = new Date(),
  horizonDays = 150,
): Promise<{ upserted: number; scanned: number; pruned: number }> {
  const stocks = await db.entity.findMany({
    where: { type: "STOCK", ticker: { not: null } },
    select: { id: true, ticker: true },
  });
  const idByCode = new Map(stocks.map((s) => [s.ticker!, s.id]));

  const from = ymd(now);
  const to = ymd(new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000));

  // code → 最近一期待披露
  const best = new Map<string, Appointment>();
  let scanned = 0;
  let page = 1;
  let pages = 1;
  let completed = false;
  while (page <= pages && page <= 20) {
    const { rows, pages: total } = await fetchPage(from, to, page);
    pages = total;
    if (rows.length === 0) break;
    for (const r of rows) {
      scanned++;
      const code = (r.SECURITY_CODE ?? "").trim();
      if (!idByCode.has(code)) continue;
      const appt = parseAppointment(r, now);
      if (!appt || appt.actual || appt.daysUntil < 0) continue;
      const cur = best.get(code);
      if (!cur || appt.date.getTime() < cur.date.getTime()) best.set(code, appt);
    }
    page++;
    if (page > pages) completed = true;
  }

  let upserted = 0;
  for (const [code, appt] of best) {
    const entityId = idByCode.get(code);
    const s = entityId ? disclosureSignal(appt, now) : null;
    if (!entityId || !s) continue;
    await db.entitySignal.upsert({
      where: { entityId_kind: { entityId, kind: s.kind } },
      create: {
        entityId,
        kind: s.kind,
        label: s.label,
        numValue: s.numValue,
        detail: s.detail,
        asOf: s.asOf,
      },
      update: {
        label: s.label,
        numValue: s.numValue,
        detail: s.detail,
        asOf: s.asOf,
      },
    });
    upserted++;
  }

  // 过期清理：本轮没刷新到的 disclosure 信号 = 预约日已过或已披露，删掉——
  // 否则个股页会永远挂着一个过去的「预约 X 披露」，比没有更糟。
  // 用 asOf 做水位线而不是 id 名单：不需要拼 5000 个 id，且天然只删「没被本轮覆盖」的。
  // 守卫：整轮翻页跑完 **且** 确实写进了东西才清理——半路失败时清理会把好数据一起删光。
  let pruned = 0;
  if (completed && upserted > 0) {
    const r = await db.entitySignal.deleteMany({
      where: { kind: "disclosure", asOf: { lt: now } },
    });
    pruned = r.count;
  }

  return { upserted, scanned, pruned };
}
