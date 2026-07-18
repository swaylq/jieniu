import { describe, it, expect } from "vitest";
import {
  normalizeTitle,
  isLowValueTitle,
  stripEntityPrefix,
  crossSourceKey,
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
