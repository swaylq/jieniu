import { describe, it, expect } from "vitest";
import { disclosureSignal, type DisclosureDetail } from "./disclosure";
import { parseAppointment, type AppointRow } from "~/lib/disclosure";

const row: AppointRow = {
  SECURITY_CODE: "600519",
  REPORT_TYPE: "2",
  REPORT_YEAR: "2026",
  REPORT_DATE: "2026-06-30 00:00:00",
  FIRST_APPOINT_DATE: "2026-08-15 00:00:00",
  ACTUAL_PUBLISH_DATE: null,
};
const now = new Date(2026, 6, 28);

describe("disclosureSignal", () => {
  it("产出 kind=disclosure 的 EntitySignal 载荷", () => {
    const s = disclosureSignal(parseAppointment(row, now)!, now)!;
    expect(s.kind).toBe("disclosure");
    expect(s.label).toContain("2026 年半年报");
    expect(s.label).toContain("08/15");
  });

  it("label 里不写「还有 N 天」——存进库会隔天就过期，天数交给渲染时算", () => {
    const s = disclosureSignal(parseAppointment(row, now)!, now)!;
    expect(s.label).not.toContain("天");
  });

  it("detail 存绝对日期，供 UI 重新计算倒计时", () => {
    const s = disclosureSignal(parseAppointment(row, now)!, now)!;
    const d = s.detail as DisclosureDetail;
    expect(d.reportKey).toBe("2026H1");
    expect(d.date.slice(0, 10)).toBe("2026-08-15");
    expect(d.rescheduled).toBe(false);
  });

  it("改期过的要标出来——投资者需要知道公司推迟过", () => {
    const s = disclosureSignal(
      parseAppointment({ ...row, FIRST_CHANGE_DATE: "2026-08-28 00:00:00" }, now)!,
      now,
    )!;
    expect(s.label).toContain("已改期");
    expect((s.detail as DisclosureDetail).rescheduled).toBe(true);
  });

  it("已实际披露的不写成待披露信号——倒计时只给未来", () => {
    const done = parseAppointment({ ...row, ACTUAL_PUBLISH_DATE: "2026-08-15 00:00:00" }, now)!;
    expect(disclosureSignal(done, now)).toBeNull();
  });
});
