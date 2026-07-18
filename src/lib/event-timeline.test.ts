import { describe, expect, it } from "vitest";

import { buildEventTimeline, FOLLOWUP_LABEL } from "./event-timeline";

const s = (over: Partial<Parameters<typeof buildEventTimeline>[0][number]>) => ({
  dimensionKey: "订单",
  direction: "bull",
  materiality: 60,
  note: "n",
  newsTitle: "t",
  newsId: "nid",
  publishedAt: new Date("2026-06-01"),
  ...over,
});

describe("buildEventTimeline", () => {
  it("剔除非材料级(<40)信号", () => {
    const tl = buildEventTimeline([s({ materiality: 20 })], []);
    expect(tl).toHaveLength(0);
  });

  it("同维度后续同向 → 后续得到印证", () => {
    const tl = buildEventTimeline(
      [
        s({ direction: "bull", publishedAt: new Date("2026-06-01") }),
        s({ direction: "bull", publishedAt: new Date("2026-06-20") }),
      ],
      [],
    );
    // 最早那条应被后续印证
    const earliest = tl[tl.length - 1];
    expect(earliest.kind).toBe("signal");
    if (earliest.kind === "signal") expect(earliest.followUp).toBe("confirmed");
  });

  it("同维度后续反向 → 后续被反转", () => {
    const tl = buildEventTimeline(
      [
        s({ direction: "bull", publishedAt: new Date("2026-06-01") }),
        s({ direction: "bear", publishedAt: new Date("2026-06-20") }),
      ],
      [],
    );
    const earliest = tl[tl.length - 1];
    if (earliest.kind === "signal") expect(earliest.followUp).toBe("reversed");
  });

  it("无后续同维度材料信号 → 尚待后续验证", () => {
    const tl = buildEventTimeline([s({ dimensionKey: "毛利率" })], []);
    const only = tl[0];
    if (only.kind === "signal") expect(only.followUp).toBe("pending");
  });

  it("信号 + 决策按时间倒序交织", () => {
    const tl = buildEventTimeline(
      [s({ publishedAt: new Date("2026-06-01") })],
      [{ action: "ADD", reason: "回调加仓", createdAt: new Date("2026-06-10") }],
    );
    expect(tl).toHaveLength(2);
    expect(tl[0].kind).toBe("decision"); // 6-10 更近 → 排前
    expect(tl[1].kind).toBe("signal");
  });

  it("FOLLOWUP_LABEL 三态齐全", () => {
    expect(FOLLOWUP_LABEL.confirmed).toBeTruthy();
    expect(FOLLOWUP_LABEL.reversed).toBeTruthy();
    expect(FOLLOWUP_LABEL.pending).toBeTruthy();
  });
});
