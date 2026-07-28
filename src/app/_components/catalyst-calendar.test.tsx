import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalystCalendar } from "./catalyst-calendar";
import { upcomingDisclosureNodes } from "~/lib/earnings-calendar";

const now = new Date(2026, 6, 28);
const nodes = upcomingDisclosureNodes(now, 2);
const appointment = {
  periodLabel: "2026 年半年报",
  date: "2026-08-15",
  rescheduled: false,
};

describe("CatalystCalendar · 预约披露日", () => {
  it("有预约披露日时置顶显示，精确到天并给倒计时", () => {
    const html = renderToStaticMarkup(
      <CatalystCalendar nodes={nodes} appointment={appointment} now={now} />,
    );
    expect(html).toContain("2026 年半年报");
    expect(html).toContain("08/15");
    expect(html).toContain("还有 18 天");
    expect(html).toContain("预约披露");
  });

  it("给了 previewHref 时带一个到财报前瞻页的入口", () => {
    const html = renderToStaticMarkup(
      <CatalystCalendar
        nodes={nodes}
        appointment={appointment}
        now={now}
        previewHref="/entity/abc/earnings"
      />,
    );
    expect(html).toContain("/entity/abc/earnings");
    expect(html).toContain("财报前瞻");
  });

  it("没给 previewHref 就不出入口——别给出死链", () => {
    const html = renderToStaticMarkup(
      <CatalystCalendar nodes={nodes} appointment={appointment} now={now} />,
    );
    expect(html).not.toContain("财报前瞻");
  });

  it("改期过的要标出来", () => {
    const html = renderToStaticMarkup(
      <CatalystCalendar
        nodes={nodes}
        appointment={{ ...appointment, rescheduled: true }}
        now={now}
      />,
    );
    expect(html).toContain("已改期");
  });

  it("有精确预约日时，脚注不再说「确切财报日暂未接入」", () => {
    const html = renderToStaticMarkup(
      <CatalystCalendar nodes={nodes} appointment={appointment} now={now} />,
    );
    expect(html).not.toContain("暂未接入");
  });

  it("没有预约日时退回法定最晚披露日，脚注保持原样——不编造精确日", () => {
    const html = renderToStaticMarkup(<CatalystCalendar nodes={nodes} now={now} />);
    expect(html).toContain("最晚");
    expect(html).toContain("暂未接入");
    expect(html).not.toContain("预约披露");
  });

  it("预约日已过（倒计时为负）时不显示——过期节点比没有更糟", () => {
    const html = renderToStaticMarkup(
      <CatalystCalendar
        nodes={nodes}
        appointment={{ ...appointment, date: "2026-07-01" }}
        now={now}
      />,
    );
    expect(html).not.toContain("预约披露");
  });
});
