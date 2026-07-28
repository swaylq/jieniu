/**
 * 定期报告 · 预约披露日（东财数据中心 `RPT_PUBLIC_BS_APPOIN`）。
 *
 * 借鉴富途「牛牛财报站」头部的**财报倒计时**——它能精确到「07/28 美东盘前」，
 * 而解牛此前的催化日历只能给**法定最晚披露日**（年报 4/30、半年报 8/31、三季报 10/31），
 * 对个股永远早得没有信息量。交易所的预约披露时间表是公司自己报备的确定性日程，
 * 有变更也有留痕（三次变更字段），拿来做倒计时既准确又不越界。
 *
 * 铁律：只搬确定性日程，不预测披露日；预约日已过而未披露的不显示为「接下来」（宁可空着）。
 * 日期一律按**本地日**解析——源给的是裸 timestamp，当 UTC 解析会整体偏 8 小时。
 */

export type AppointRow = {
  SECURITY_CODE?: string;
  REPORT_TYPE?: string; // 1=一季报 2=半年报 3=三季报 4=年报
  REPORT_YEAR?: string;
  REPORT_DATE?: string | null; // 报告期末
  FIRST_APPOINT_DATE?: string | null;
  FIRST_CHANGE_DATE?: string | null;
  SECOND_CHANGE_DATE?: string | null;
  THIRD_CHANGE_DATE?: string | null;
  ACTUAL_PUBLISH_DATE?: string | null;
};

export type Appointment = {
  reportKey: string; // 2026Q1 / 2026H1 / 2026Q3 / 2026A
  periodLabel: string; // 「2026 年半年报」
  /** 生效日期：实际披露日 > 最后一次变更 > 首次预约。 */
  date: Date;
  actual: boolean; // 已实际披露
  rescheduled: boolean; // 改过期
  /** 距今天数（向下取整的自然日差；已披露的为负或 0）。 */
  daysUntil: number;
};

const TYPE_META: Record<string, { label: string; key: string }> = {
  "1": { label: "一季报", key: "Q1" },
  "2": { label: "半年报", key: "H1" },
  "3": { label: "三季报", key: "Q3" },
  "4": { label: "年报", key: "A" },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "2026-08-15 00:00:00" / "2026-08-15" → **本地** 8/15 00:00。非法返回 null。
 * 源给的是裸 timestamp（无时区），当 UTC 解析会整体偏 8 小时。
 */
export function parseLocalDay(s: string | null | undefined): Date | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * 本地日 → "YYYY-MM-DD"。**披露日是日历日、不是时刻**，落库/传参一律用这个而不是
 * `toISOString()`——后者会把本地 8/15 00:00 CST 写成 `2026-08-14T16:00Z`，截前 10 位就掉一天。
 */
export function formatLocalDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const localDate = parseLocalDay;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function parseAppointment(
  row: AppointRow,
  now: Date = new Date(),
): Appointment | null {
  const meta = TYPE_META[(row.REPORT_TYPE ?? "").trim()];
  if (!meta) return null;

  const year = (row.REPORT_YEAR ?? "").trim() || (row.REPORT_DATE ?? "").slice(0, 4);
  if (!/^\d{4}$/.test(year)) return null;

  const actualDate = localDate(row.ACTUAL_PUBLISH_DATE);
  const changed =
    localDate(row.THIRD_CHANGE_DATE) ??
    localDate(row.SECOND_CHANGE_DATE) ??
    localDate(row.FIRST_CHANGE_DATE);
  const appointed = changed ?? localDate(row.FIRST_APPOINT_DATE);

  const date = actualDate ?? appointed;
  if (!date) return null;

  return {
    reportKey: `${year}${meta.key}`,
    periodLabel: `${year} 年${meta.label}`,
    date,
    actual: actualDate !== null,
    rescheduled: changed !== null,
    daysUntil: Math.round(
      (startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS,
    ),
  };
}

/** 渲染层需要的最小结构（催化日历的 `appointment` 入参）。 */
export type AppointmentView = {
  periodLabel: string;
  date: string; // YYYY-MM-DD
  rescheduled: boolean;
};

/**
 * `EntitySignal.detail`（Prisma JSON，运行时任意值）→ `AppointmentView`。
 * 日期必须是纯 `YYYY-MM-DD`：库里若残留过 `toISOString()` 写法就会掉一天，宁可不显示。
 */
export function parseAppointmentView(detail: unknown): AppointmentView | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const d = detail as Record<string, unknown>;
  const periodLabel = typeof d.periodLabel === "string" ? d.periodLabel.trim() : "";
  const date = typeof d.date === "string" ? d.date.trim() : "";
  if (!periodLabel || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { periodLabel, date, rescheduled: d.rescheduled === true };
}

/** 接下来那次财报：尚未披露、且预约日不早于今天，取最近的一个。全都披露完/全过期 → null。 */
export function nextDisclosure(
  rows: AppointRow[],
  now: Date = new Date(),
): Appointment | null {
  const upcoming = rows
    .map((r) => parseAppointment(r, now))
    .filter((a): a is Appointment => a !== null && !a.actual && a.daysUntil >= 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return upcoming[0] ?? null;
}

/** 历史上已实际披露的报告，按披露日降序——供「历史财报日反应」取样本。 */
export function pastDisclosures(
  rows: AppointRow[],
  limit?: number,
  now: Date = new Date(),
): Appointment[] {
  const past = rows
    .map((r) => parseAppointment(r, now))
    .filter((a): a is Appointment => a !== null && a.actual)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  return typeof limit === "number" ? past.slice(0, limit) : past;
}
