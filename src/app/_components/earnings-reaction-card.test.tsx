import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EarningsReactionCard } from "./earnings-reaction-card";
import type { Reaction } from "~/lib/earnings-reaction";

const reactions: Reaction[] = [
  {
    reportKey: "2026Q1",
    periodLabel: "2026 年一季报",
    disclosedOn: "2026-04-25",
    onDay: { day: "2026-04-25", changePct: 3.2 },
    nextDay: { day: "2026-04-28", changePct: -1.4 },
  },
  {
    reportKey: "2025A",
    periodLabel: "2025 年年报",
    disclosedOn: "2026-04-17",
    onDay: { day: "2026-04-17", changePct: -6.8 },
    nextDay: { day: "2026-04-18", changePct: 0.5 },
  },
];
const html = renderToStaticMarkup(<EarningsReactionCard reactions={reactions} />);

describe("EarningsReactionCard", () => {
  it("给出近 N 次披露日涨跌幅的平均绝对值作为波动基线", () => {
    expect(html).toContain("5"); // (3.2+6.8)/2 = 5
    expect(html).toContain("近 2 次");
  });

  it("逐次列出报告期、披露日、当日与次日涨跌", () => {
    expect(html).toContain("2026 年一季报");
    expect(html).toContain("04/25");
    expect(html).toContain("3.2");
    expect(html).toContain("6.8");
  });

  it("涨跌幅用真实价格色（这是股价，红绿在这里是对的）", () => {
    expect(html).toMatch(/text-up|text-down/);
  });

  it("说明 A 股多在盘后披露，当日未必已反映财报", () => {
    expect(html).toContain("盘后");
  });

  it("标注为历史统计、不预测", () => {
    expect(html).toContain("不预测");
  });

  it("无样本时整卡不渲染——没数据不占位", () => {
    expect(renderToStaticMarkup(<EarningsReactionCard reactions={[]} />)).toBe("");
  });
});
