import { describe, it, expect } from "vitest";
import { parseJsonResult, evalChecks } from "./checks";
import type { CheckDef } from "./types";

describe("parseJsonResult", () => {
  it("取最后一行的 JSON_RESULT", () => {
    const out = '【抓取活跃度】\n  近24小时新入库: 312\nJSON_RESULT {"n24":312}';
    expect(parseJsonResult(out)).toEqual({ n24: 312 });
  });

  it("JSON_RESULT 后面还有别的行也能找到", () => {
    const out = 'JSON_RESULT {"a":1}\n收尾日志';
    expect(parseJsonResult(out)).toEqual({ a: 1 });
  });

  it("没有 JSON_RESULT 返回 null", () => {
    expect(parseJsonResult("普通输出\n第二行")).toBeNull();
  });

  it("JSON 坏了返回 null，不抛", () => {
    expect(parseJsonResult("JSON_RESULT {坏的")).toBeNull();
  });
});

const DEFS: CheckDef[] = [
  {
    id: "ingest-24h",
    metric: "n24",
    op: "eq",
    threshold: 0,
    message: "近24h新入库为 0，ingest 可能挂了",
  },
  {
    id: "news-7d",
    metric: "pctNews7d",
    op: "lt",
    threshold: 85,
    message: "近7天有资讯占比跌破 85%",
  },
];

describe("evalChecks", () => {
  it("全部达标时不出告警", () => {
    expect(evalChecks(DEFS, { n24: 312, pctNews7d: 91.2 })).toEqual([]);
  });

  it("命中的判据带上实际值与阈值", () => {
    const alerts = evalChecks(DEFS, { n24: 0, pctNews7d: 91.2 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ id: "ingest-24h", value: 0, threshold: 0 });
  });

  it("多项同时命中都要报出来", () => {
    expect(evalChecks(DEFS, { n24: 0, pctNews7d: 80 }).map((a) => a.id)).toEqual([
      "ingest-24h",
      "news-7d",
    ]);
  });

  it("指标缺失算命中——不能静默放过", () => {
    const alerts = evalChecks(DEFS, { pctNews7d: 91.2 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.id).toBe("ingest-24h");
    expect(alerts[0]!.message).toContain("缺少指标");
  });
});
