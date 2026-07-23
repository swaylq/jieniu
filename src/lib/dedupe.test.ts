import { describe, it, expect } from "vitest";
import {
  normalizeTitle,
  isLowValueTitle,
  stripEntityPrefix,
  crossSourceKey,
  historicalKey,
} from "./dedupe";

describe("normalizeTitle", () => {
  it("strips punctuation/whitespace/brackets so cross-source dupes match", () => {
    expect(normalizeTitle("港股公告：翌日披露报表")).toBe(
      normalizeTitle("港股公告 翌日披露报表"),
    );
    expect(normalizeTitle('韩国拟打造"韩版星链"')).toBe("韩国拟打造韩版星链");
  });
  it("keeps letters and digits", () => {
    expect(normalizeTitle("宁德时代(300750)公告")).toBe("宁德时代300750公告");
  });
});

describe("isLowValueTitle", () => {
  it("flags routine boilerplate announcements", () => {
    expect(isLowValueTitle("港股公告：翌日披露报表")).toBe(true);
    expect(isLowValueTitle("某某:股票交易异常波动公告")).toBe(true);
    expect(isLowValueTitle("关于召开2026年第一次临时股东大会的通知")).toBe(true);
  });
  it("keeps substantive news", () => {
    expect(
      isLowValueTitle("阿科力:关于公司控制权拟发生变更的提示性公告"),
    ).toBe(false);
    expect(isLowValueTitle("比亚迪6月新建336座闪充站")).toBe(false);
  });
});

describe("stripEntityPrefix", () => {
  it("strips 东财式「公司名:」前缀", () => {
    expect(stripEntityPrefix("恒力石化:恒力石化2026年半年度业绩预增公告")).toBe(
      "恒力石化2026年半年度业绩预增公告",
    );
    expect(stripEntityPrefix("宏发股份：关于控股股东协议转让公司部分股份")).toBe(
      "关于控股股东协议转让公司部分股份",
    );
  });
  it("leaves prefix-less titles unchanged", () => {
    expect(stripEntityPrefix("关于重大资产重组的进展公告")).toBe(
      "关于重大资产重组的进展公告",
    );
  });
});

describe("crossSourceKey", () => {
  it("makes 东财(带前缀) 与 巨潮(不带前缀) 的同一公告 key 相同", () => {
    const a = crossSourceKey("恒力石化:恒力石化2026年半年度业绩预增公告", ["e1"]);
    const b = crossSourceKey("恒力石化2026年半年度业绩预增公告", ["e1"]);
    expect(a).toBe(b);
  });
  it("不同公司的同名模板公告 key 不同（靠实体集区分，防误并）", () => {
    const a = crossSourceKey("关于重大资产重组的进展公告", ["wanxiang"]);
    const b = crossSourceKey("关于重大资产重组的进展公告", ["hainan"]);
    expect(a).not.toBe(b);
  });
  it("实体集顺序无关", () => {
    expect(crossSourceKey("某公告", ["a", "b"])).toBe(
      crossSourceKey("某公告", ["b", "a"]),
    );
  });
});

describe("historicalKey", () => {
  const d = (s: string) => new Date(`${s}T08:00:00.000Z`);

  it("同一份公告在东财/巨潮两个源里 key 相同（跨源重复照样杀掉）", () => {
    const a = historicalKey(
      "恒力石化:恒力石化2026年半年度业绩预增公告",
      ["e1"],
      d("2026-03-14"),
    );
    const b = historicalKey(
      "恒力石化2026年半年度业绩预增公告",
      ["e1"],
      d("2026-03-14"),
    );
    expect(a).toBe(b);
  });

  it("同名但不同日期的周期性公告 key 不同（回填一年不会把 12 次回购进展并成 1 条）", () => {
    const jan = historicalKey("关于回购公司股份进展的公告", ["e1"], d("2026-01-05"));
    const feb = historicalKey("关于回购公司股份进展的公告", ["e1"], d("2026-02-04"));
    expect(jan).not.toBe(feb);
  });

  it("同日同名但不同公司 key 不同", () => {
    const a = historicalKey("关于回购公司股份进展的公告", ["a"], d("2026-01-05"));
    const b = historicalKey("关于回购公司股份进展的公告", ["b"], d("2026-01-05"));
    expect(a).not.toBe(b);
  });

  it("非法日期不抛异常", () => {
    expect(() =>
      historicalKey("某公告", ["e1"], new Date("not-a-date")),
    ).not.toThrow();
  });
});
