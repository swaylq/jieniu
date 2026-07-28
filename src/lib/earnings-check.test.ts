import { describe, it, expect } from "vitest";
import { earningsCheckable } from "./earnings-check";

const dims = [
  { key: "growth", watch: "新能源业务营收增速能否维持 30% 以上", bull: "营收同比加速", bear: "增速掉到 15% 以下" },
  { key: "margin", watch: "毛利率是否见底回升", bull: "毛利率环比改善", bear: "价格战继续压毛利" },
  { key: "policy", watch: "行业补贴政策是否延续", bull: "新政落地", bear: "补贴退坡" },
  { key: "mgmt", watch: "核心管理层是否稳定", bull: "无人事动荡", bear: "核心高管离职" },
];

describe("earningsCheckable", () => {
  it("挑出财报能给出数据的维度，跳过政策/人事这类财报答不了的", () => {
    const out = earningsCheckable(dims);
    expect(out.map((d) => d.key)).toEqual(["growth", "margin"]);
  });

  it("标出命中的财务口径词，便于在界面上说清「凭什么算可验证」", () => {
    const out = earningsCheckable(dims);
    expect(out[0]!.matched).toContain("营收");
    expect(out[1]!.matched).toContain("毛利率");
  });

  it("bull / bear 文本里的财务词也算数，不只看 watch", () => {
    const out = earningsCheckable([
      { key: "x", watch: "下游需求好不好", bear: "存货大幅积压" },
    ]);
    expect(out.map((d) => d.key)).toEqual(["x"]);
    expect(out[0]!.matched).toContain("存货");
  });

  it("被用户静音的维度不参与——尊重 UserThesis 的静音设置", () => {
    const out = earningsCheckable([
      { key: "growth", watch: "营收增速", muted: true },
      { key: "margin", watch: "毛利率" },
    ]);
    expect(out.map((d) => d.key)).toEqual(["margin"]);
  });

  it("用户标了高优先级的排前面", () => {
    const out = earningsCheckable([
      { key: "a", watch: "营收增速", priority: "normal" },
      { key: "b", watch: "毛利率", priority: "high" },
    ]);
    expect(out.map((d) => d.key)).toEqual(["b", "a"]);
  });

  it("非数组 / 坏结构一律返回空，不抛", () => {
    expect(earningsCheckable(null)).toEqual([]);
    expect(earningsCheckable("x")).toEqual([]);
    expect(earningsCheckable([{ nope: 1 }])).toEqual([]);
  });

  it("limit 截断", () => {
    expect(earningsCheckable(dims, 1)).toHaveLength(1);
  });

  it("一条财务词都没命中时返回空——不硬凑「都能验证」", () => {
    expect(
      earningsCheckable([{ key: "p", watch: "行业政策是否延续" }]),
    ).toEqual([]);
  });
});
