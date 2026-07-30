import { describe, it, expect } from "vitest";
import { evalBaselineChecks, type BaselineCheckDef } from "./baseline";

// 夹具用 2026-07-30 真实的 JobRun.metrics 数值，不手编。
const REAL: Record<string, number> = {
  blankCompanies: 81,
  pctNews7d: 49.04,
  dupeGroups: 15,
  n24: 3218,
};

const DEFS: BaselineCheckDef[] = [
  { id: "blank-companies", metric: "blankCompanies", op: "riseGt", delta: 20, message: "空白公司一夜暴增" },
  { id: "news-7d", metric: "pctNews7d", op: "dropGt", delta: 8, message: "近 7 天资讯覆盖骤降" },
  { id: "dupe-groups", metric: "dupeGroups", op: "riseGt", delta: 50, message: "重复组暴增，去重失效" },
];

describe("基线式判据", () => {
  it("正常日：结构性常数原样不动 → 一条都不命中（这正是它取代绝对阈值的理由）", () => {
    // 三个值都是「永久命中绝对阈值」的那组数，但与昨天一样 → 不该报
    expect(evalBaselineChecks(DEFS, REAL, REAL)).toHaveLength(0);
  });

  it("小幅波动不命中——阈值按正常量级的 10 倍取，不与被测行为同量级", () => {
    const today = { ...REAL, blankCompanies: 84, pctNews7d: 47.3, dupeGroups: 18 };
    expect(evalBaselineChecks(DEFS, today, REAL)).toHaveLength(0);
  });

  it("故障日：空白公司一夜多 50 家 → 命中，且信里带得出「上次→本次」", () => {
    const alerts = evalBaselineChecks(DEFS, { ...REAL, blankCompanies: 131 }, REAL);
    expect(alerts.map((a) => a.id)).toEqual(["blank-companies"]);
    expect(alerts[0]!.message).toContain("81");
    expect(alerts[0]!.message).toContain("131");
  });

  it("故障日：覆盖率一天掉 10 个点（源被封）→ 命中", () => {
    const alerts = evalBaselineChecks(DEFS, { ...REAL, pctNews7d: 39.0 }, REAL);
    expect(alerts.map((a) => a.id)).toEqual(["news-7d"]);
  });

  it("方向性：覆盖率**上升**不命中，空白公司**减少**不命中", () => {
    const better = { ...REAL, pctNews7d: 62.0, blankCompanies: 10, dupeGroups: 0 };
    expect(evalBaselineChecks(DEFS, better, REAL)).toHaveLength(0);
  });

  it("首跑无基线默认不报——基线判据的第一次运行天然无从判断", () => {
    expect(evalBaselineChecks(DEFS, REAL, null)).toHaveLength(0);
    const strict = DEFS.map((d) => ({ ...d, alertWhenNoBaseline: true }));
    expect(evalBaselineChecks(strict, REAL, null)).toHaveLength(3);
  });

  it("指标缺失按命中处理——脚本改坏了不能表现成一片绿", () => {
    const alerts = evalBaselineChecks(DEFS, { n24: 1 }, REAL);
    expect(alerts).toHaveLength(3);
    for (const a of alerts) expect(a.message).toContain("缺少指标");
  });

  it("上次缺该指标时按「无基线」处理，不拿 undefined 当 0 算出假暴涨", () => {
    expect(evalBaselineChecks(DEFS, REAL, { n24: 1 })).toHaveLength(0);
  });
});
