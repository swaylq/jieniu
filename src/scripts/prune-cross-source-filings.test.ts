import { describe, it, expect } from "vitest";
import { pickKeeper, type Item } from "./prune-cross-source-filings";

const mk = (
  sourceKey: string,
  opts: { content?: string | null; day?: string } = {},
): Item => ({
  id: `${sourceKey}-${opts.day ?? "01"}`,
  title: "关于拟注销控股子公司的公告",
  publishedAt: new Date(`2026-05-${opts.day ?? "24"}T09:00:00Z`),
  content: opts.content ?? null,
  sourceKey,
});

// 2026-07-30 run6：tie-break 从「留东财」改成「留巨潮」。原理由「东财有 art_code 可继续补正文」
// 方向相反——实测正文覆盖率 巨潮 37.0% vs 东财 1.0%，且巨潮是法定披露站、URL 就是公告 PDF。
describe("pickKeeper · 跨源同一份公告保留哪一条", () => {
  it("有正文的胜出，与源无关（正文是第一优先级）", () => {
    const keeper = pickKeeper([
      mk("cninfo-announcement"),
      mk("eastmoney-announcement", { content: "正文若干" }),
    ]);
    expect(keeper.sourceKey).toBe("eastmoney-announcement");
  });

  it("都没正文时保留巨潮——一手来源，且正文覆盖率高 37 倍", () => {
    const keeper = pickKeeper([
      mk("eastmoney-announcement", { day: "25" }),
      mk("cninfo-announcement", { day: "24" }),
    ]);
    expect(keeper.sourceKey).toBe("cninfo-announcement");
  });

  it("都没正文且巨潮反而更晚，仍保留巨潮（源优先于日期）", () => {
    const keeper = pickKeeper([
      mk("eastmoney-announcement", { day: "24" }),
      mk("cninfo-announcement", { day: "26" }),
    ]);
    expect(keeper.sourceKey).toBe("cninfo-announcement");
  });

  it("同源同条件时留最早的", () => {
    const keeper = pickKeeper([
      mk("cninfo-announcement", { day: "26" }),
      mk("cninfo-announcement", { day: "24" }),
    ]);
    expect(keeper.publishedAt.toISOString()).toContain("2026-05-24");
  });
});
