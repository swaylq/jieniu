import { describe, it, expect } from "vitest";
import {
  parseAppointment,
  nextDisclosure,
  pastDisclosures,
  formatLocalDay,
  parseLocalDay,
  parseAppointmentView,
  type AppointRow,
} from "./disclosure";

const semi2026: AppointRow = {
  SECURITY_CODE: "600519",
  REPORT_TYPE: "2",
  REPORT_YEAR: "2026",
  REPORT_DATE: "2026-06-30 00:00:00",
  FIRST_APPOINT_DATE: "2026-08-15 00:00:00",
  FIRST_CHANGE_DATE: null,
  SECOND_CHANGE_DATE: null,
  THIRD_CHANGE_DATE: null,
  ACTUAL_PUBLISH_DATE: null,
};
const q1_2026: AppointRow = {
  SECURITY_CODE: "600519",
  REPORT_TYPE: "1",
  REPORT_YEAR: "2026",
  REPORT_DATE: "2026-03-31 00:00:00",
  FIRST_APPOINT_DATE: "2026-04-25 00:00:00",
  ACTUAL_PUBLISH_DATE: "2026-04-25 00:00:00",
};
const annual2025: AppointRow = {
  SECURITY_CODE: "600519",
  REPORT_TYPE: "4",
  REPORT_YEAR: "2025",
  REPORT_DATE: "2025-12-31 00:00:00",
  FIRST_APPOINT_DATE: "2026-04-17 00:00:00",
  ACTUAL_PUBLISH_DATE: "2026-04-17 00:00:00",
};

describe("parseAppointment", () => {
  it("按报告类型给出报告期标签与 key", () => {
    const a = parseAppointment(semi2026)!;
    expect(a.reportKey).toBe("2026H1");
    expect(a.periodLabel).toBe("2026 年半年报");
  });

  it("四种报告类型都能解析", () => {
    expect(parseAppointment({ ...semi2026, REPORT_TYPE: "1" })!.periodLabel).toBe("2026 年一季报");
    expect(parseAppointment({ ...semi2026, REPORT_TYPE: "3" })!.periodLabel).toBe("2026 年三季报");
    expect(parseAppointment({ ...semi2026, REPORT_TYPE: "4" })!.periodLabel).toBe("2026 年年报");
  });

  it("未披露时取预约日，已披露时取实际披露日", () => {
    expect(parseAppointment(semi2026)!.actual).toBe(false);
    expect(parseAppointment(semi2026)!.date.getMonth()).toBe(7); // 8 月
    const done = parseAppointment(q1_2026)!;
    expect(done.actual).toBe(true);
    expect(done.date.getDate()).toBe(25);
  });

  it("改期时取最后一次变更日，并标记已改期", () => {
    const a = parseAppointment({
      ...semi2026,
      FIRST_CHANGE_DATE: "2026-08-20 00:00:00",
      SECOND_CHANGE_DATE: "2026-08-28 00:00:00",
    })!;
    expect(a.date.getDate()).toBe(28);
    expect(a.rescheduled).toBe(true);
  });

  it("日期按本地日解析——不能因时区把 8/15 挪到 8/14", () => {
    // 裸 timestamp 当 UTC 解析会整体偏 8 小时（naive-timestamp 陷阱）。
    const a = parseAppointment(semi2026)!;
    expect(a.date.getDate()).toBe(15);
    expect(a.date.getHours()).toBe(0);
  });

  it("无任何日期 / 类型不认识 → null，不猜", () => {
    expect(parseAppointment({ ...semi2026, FIRST_APPOINT_DATE: null })).toBeNull();
    expect(parseAppointment({ ...semi2026, REPORT_TYPE: "9" })).toBeNull();
  });
});

describe("本地日历日的序列化", () => {
  it("formatLocalDay / parseLocalDay 往返不掉一天——披露日是日历日，不是时刻", () => {
    // toISOString() 会把本地 8/15 00:00 CST 写成 2026-08-14T16:00Z，截前 10 位就成了 8/14。
    const d = parseAppointment(semi2026)!.date;
    expect(formatLocalDay(d)).toBe("2026-08-15");
    expect(parseLocalDay("2026-08-15")!.getDate()).toBe(15);
    expect(parseLocalDay("2026-08-15")!.getMonth()).toBe(7);
  });

  it("非法日期字符串返回 null", () => {
    expect(parseLocalDay("")).toBeNull();
    expect(parseLocalDay("x")).toBeNull();
  });
});

describe("nextDisclosure", () => {
  const rows = [annual2025, q1_2026, semi2026];

  it("取最近一个尚未披露的预约日，并给出剩余天数", () => {
    const n = nextDisclosure(rows, new Date(2026, 6, 28))!;
    expect(n.reportKey).toBe("2026H1");
    expect(n.daysUntil).toBe(18);
  });

  it("预约日已过却仍未披露的不算「接下来」——不显示过期节点", () => {
    expect(nextDisclosure(rows, new Date(2026, 8, 1))).toBeNull();
  });

  it("全部已披露时返回 null", () => {
    expect(nextDisclosure([annual2025, q1_2026], new Date(2026, 6, 28))).toBeNull();
  });

  it("当天披露算 0 天，不算过期", () => {
    const n = nextDisclosure(rows, new Date(2026, 7, 15))!;
    expect(n.daysUntil).toBe(0);
  });
});

describe("parseAppointmentView", () => {
  it("从 EntitySignal.detail 还原出渲染所需的三个字段", () => {
    const v = parseAppointmentView({
      reportKey: "2026H1",
      periodLabel: "2026 年半年报",
      date: "2026-08-15",
      rescheduled: true,
    })!;
    expect(v.periodLabel).toBe("2026 年半年报");
    expect(v.date).toBe("2026-08-15");
    expect(v.rescheduled).toBe(true);
  });

  it("结构不对 / 缺日期 → null，不抛也不猜", () => {
    expect(parseAppointmentView(undefined)).toBeNull();
    expect(parseAppointmentView(null)).toBeNull();
    expect(parseAppointmentView("x")).toBeNull();
    expect(parseAppointmentView({ periodLabel: "x" })).toBeNull();
    expect(parseAppointmentView({ date: "2026-08-15" })).toBeNull();
  });

  it("日期格式非 YYYY-MM-DD 一律拒绝——老数据里可能残留 ISO 时刻", () => {
    expect(
      parseAppointmentView({
        periodLabel: "2026 年半年报",
        date: "2026-08-14T16:00:00.000Z",
      }),
    ).toBeNull();
  });
});

describe("pastDisclosures", () => {
  it("只取已实际披露的，按日期降序", () => {
    const past = pastDisclosures([annual2025, q1_2026, semi2026]);
    expect(past.map((p) => p.reportKey)).toEqual(["2026Q1", "2025A"]);
  });

  it("limit 截断", () => {
    expect(pastDisclosures([annual2025, q1_2026], 1)).toHaveLength(1);
  });
});
