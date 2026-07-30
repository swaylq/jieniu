import { describe, it, expect } from "vitest";
import {
  buildEvidenceDetail,
  sourceLine,
  ymdLocal,
  type EvidenceSignal,
} from "./evidence-detail";

const sig = (o: Partial<EvidenceSignal>): EvidenceSignal => ({
  dimensionKey: "行业景气",
  direction: "bull",
  materiality: 60,
  fact: "",
  why: "",
  grade: "direct",
  newsTitle: "摩尔线程发布2026年半年度业绩预告",
  newsId: "n1",
  publishedAt: new Date(2026, 6, 17, 9, 30),
  sourceName: "公司公告",
  tier: "PRIMARY",
  ...o,
});

// 张楚寒给的抽屉样例：
//   摩尔线程发布2026年半年度业绩预告 / 来源：公司公告 | 2026-07-17 | 一级来源
//   影响判断：行业景气：轻微增强 / 公司竞争力：明显增强 / 毛利率：尚未验证
describe("buildEvidenceDetail — 复刻张楚寒的抽屉样例", () => {
  const all = [
    sig({ dimensionKey: "行业景气", materiality: 50, direction: "bull" }),
    sig({ dimensionKey: "公司竞争力", materiality: 85, direction: "bull" }),
    // 毛利率没有信号 → 尚未验证
    sig({ dimensionKey: "行业景气", newsId: "n2", materiality: 90 }), // 另一条资讯，不该混进来
  ];
  const d = buildEvidenceDetail(all[0]!, all, [
    "行业景气",
    "公司竞争力",
    "毛利率",
  ]);

  it("影响判断三行，标签与样例一致", () => {
    expect(d.impacts).toEqual([
      { dimensionKey: "行业景气", label: "轻微增强", tone: "up", touched: true },
      { dimensionKey: "公司竞争力", label: "明显增强", tone: "up", touched: true },
      { dimensionKey: "毛利率", label: "尚未验证", tone: "neutral", touched: false },
    ]);
  });

  it("只算同一条资讯——别的资讯的信号不能混进这条证据的影响判断", () => {
    // n2 那条 materiality=90 若混进来，行业景气会变成「明显增强」
    expect(d.impacts[0]!.label).toBe("轻微增强");
  });

  it("来源行：公司公告 · 2026-07-17 · 一级来源", () => {
    expect(sourceLine(d)).toBe("公司公告 · 2026-07-17 · 一级来源");
  });

  it("日期走本地时区，不能被 UTC 推前一天", () => {
    expect(ymdLocal(new Date(2026, 7, 15, 0, 30))).toBe("2026-08-15");
  });
});

describe("buildEvidenceDetail — 边界", () => {
  it("媒体来源标「媒体报道」", () => {
    const s = sig({ tier: "MEDIA", sourceName: "财联社" });
    const d = buildEvidenceDetail(s, [s], ["行业景气"]);
    expect(sourceLine(d)).toBe("财联社 · 2026-07-17 · 媒体报道");
  });

  it("newsId 缺失时按标题关联，不跨资讯错关联", () => {
    const a = sig({ newsId: null, dimensionKey: "行业景气" });
    const b = sig({ newsId: null, dimensionKey: "毛利率", newsTitle: "另一条新闻" });
    const d = buildEvidenceDetail(a, [a, b], ["行业景气", "毛利率"]);
    expect(d.impacts[1]).toMatchObject({ dimensionKey: "毛利率", touched: false });
  });

  it("触及了 thesis 之外的维度也要列出来（用户改过命题）", () => {
    const s = sig({ dimensionKey: "新命题" });
    const d = buildEvidenceDetail(s, [s], ["行业景气"]);
    expect(d.impacts.map((x) => x.dimensionKey)).toEqual(["行业景气", "新命题"]);
  });

  it("中性 + 够材料 → 尚无法判断（不是「尚未验证」，两者含义不同）", () => {
    const s = sig({ direction: "neutral", materiality: 55 });
    const d = buildEvidenceDetail(s, [s], ["行业景气"]);
    expect(d.impacts[0]!.label).toBe("尚无法判断");
  });
});
