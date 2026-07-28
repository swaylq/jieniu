import { describe, it, expect } from "vitest";
import { mergePairedSignals } from "./entity-pair";

const d = (s: string) => new Date(s);

describe("mergePairedSignals", () => {
  it("同一 kind 只留一条，取 asOf 更新的那条", () => {
    const out = mergePairedSignals([
      { kind: "consensus", label: "旧", numValue: 1, detail: {}, asOf: d("2026-07-01") },
      { kind: "consensus", label: "新", numValue: 2, detail: {}, asOf: d("2026-07-20") },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("新");
  });

  it("不同 kind 都保留", () => {
    const out = mergePairedSignals([
      { kind: "consensus", label: "a", numValue: null, detail: {}, asOf: d("2026-07-01") },
      { kind: "disclosure", label: "b", numValue: null, detail: {}, asOf: d("2026-07-01") },
      { kind: "margin", label: "c", numValue: null, detail: {}, asOf: d("2026-07-01") },
    ]);
    expect(out.map((s) => s.kind).sort()).toEqual(["consensus", "disclosure", "margin"]);
  });

  it("按 kind 升序输出，顺序稳定——信号条的排序不该随查询顺序抖动", () => {
    const out = mergePairedSignals([
      { kind: "unlock", label: "u", numValue: null, detail: {}, asOf: d("2026-07-01") },
      { kind: "consensus", label: "c", numValue: null, detail: {}, asOf: d("2026-07-01") },
    ]);
    expect(out.map((s) => s.kind)).toEqual(["consensus", "unlock"]);
  });

  it("空输入返回空", () => {
    expect(mergePairedSignals([])).toEqual([]);
  });
});
