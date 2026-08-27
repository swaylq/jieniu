import { describe, expect, it } from "vitest";

import {
  cleanOcrCode,
  cleanOcrNumber,
  parseVisionExtract,
  stripCodeFence,
  MAX_VISION_ROWS,
} from "./vision-parse";

describe("cleanOcrNumber", () => {
  it("接受纯数字与数字字符串", () => {
    expect(cleanOcrNumber(1680.5)).toBe(1680.5);
    expect(cleanOcrNumber("1680.5")).toBe(1680.5);
    expect(cleanOcrNumber(0)).toBe(0);
  });
  it("洗千分位 / 货币符号 / 单位", () => {
    expect(cleanOcrNumber("1,680.50")).toBe(1680.5);
    expect(cleanOcrNumber("1，680")).toBe(1680);
    expect(cleanOcrNumber("¥1,680.50")).toBe(1680.5);
    expect(cleanOcrNumber("100股")).toBe(100);
    expect(cleanOcrNumber("1 000")).toBe(1000);
  });
  it("空 / 占位 / 负数 / 非数 → null", () => {
    expect(cleanOcrNumber("")).toBeNull();
    expect(cleanOcrNumber("--")).toBeNull();
    expect(cleanOcrNumber("–")).toBeNull();
    expect(cleanOcrNumber(-5)).toBeNull();
    expect(cleanOcrNumber("-1,680")).toBeNull();
    expect(cleanOcrNumber("abc")).toBeNull();
    expect(cleanOcrNumber(null)).toBeNull();
    expect(cleanOcrNumber(undefined)).toBeNull();
    expect(cleanOcrNumber(NaN)).toBeNull();
  });
});

describe("cleanOcrCode", () => {
  it("6 位数字原样通过，带市场前缀也能洗出来", () => {
    expect(cleanOcrCode("600519")).toBe("600519");
    expect(cleanOcrCode("SH600519")).toBe("600519");
    expect(cleanOcrCode(600519)).toBe("600519");
  });
  it("非 6 位 → null（港股 5 位 / 美股字母 / 空）", () => {
    expect(cleanOcrCode("00700")).toBeNull();
    expect(cleanOcrCode("AAPL")).toBeNull();
    expect(cleanOcrCode("")).toBeNull();
    expect(cleanOcrCode(null)).toBeNull();
  });
});

describe("stripCodeFence", () => {
  it("剥 ```json 围栏", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence("```\n{\"a\":1}\n```")).toBe('{"a":1}');
  });
  it("无围栏原样返回", () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("parseVisionExtract", () => {
  it("解析标准输出并洗数字", () => {
    const text = JSON.stringify({
      rows: [
        { name: "贵州茅台", code: "600519", shares: "1,00", cost: "1,680.50" },
        { name: "宁德时代", code: null, shares: 200, cost: null },
      ],
      skipped: [{ name: "腾讯控股", reason: "港股" }],
    });
    const r = parseVisionExtract(text);
    expect(r).not.toBeNull();
    expect(r!.rows).toHaveLength(2);
    expect(r!.rows[0]).toEqual({ name: "贵州茅台", code: "600519", shares: 100, cost: 1680.5 });
    expect(r!.rows[1]).toEqual({ name: "宁德时代", code: null, shares: 200, cost: null });
    expect(r!.skipped).toEqual([{ name: "腾讯控股", reason: "港股" }]);
  });

  it("容忍代码块围栏与前后废话之外的纯 JSON", () => {
    const r = parseVisionExtract('```json\n{"rows":[{"name":"贵州茅台","code":"600519","shares":100,"cost":1680}],"skipped":[]}\n```');
    expect(r!.rows).toHaveLength(1);
  });

  it("坏行丢弃、好行保留", () => {
    const text = JSON.stringify({
      rows: [
        { name: "", code: "600519" }, // 无名 → 丢
        { name: "贵州茅台", code: "600519", shares: 100, cost: 1680 },
        "not an object",
      ],
    });
    const r = parseVisionExtract(text);
    expect(r!.rows).toHaveLength(1);
    expect(r!.rows[0]!.name).toBe("贵州茅台");
  });

  it("按代码/名称去重", () => {
    const text = JSON.stringify({
      rows: [
        { name: "贵州茅台", code: "600519", shares: 100, cost: 1680 },
        { name: "贵州茅台", code: "600519", shares: 100, cost: 1680 },
      ],
    });
    expect(parseVisionExtract(text)!.rows).toHaveLength(1);
  });

  it("行数封顶", () => {
    const rows = Array.from({ length: MAX_VISION_ROWS + 10 }, (_, i) => ({
      name: `股票${i}`,
      code: null,
      shares: null,
      cost: null,
    }));
    const r = parseVisionExtract(JSON.stringify({ rows }));
    expect(r!.rows.length).toBeLessThanOrEqual(MAX_VISION_ROWS);
  });

  it("非 JSON / 空 / 非对象 → null", () => {
    expect(parseVisionExtract("")).toBeNull();
    expect(parseVisionExtract("这不是 JSON")).toBeNull();
    expect(parseVisionExtract('"just a string"')).toBeNull();
    expect(parseVisionExtract("[1,2,3]")).toBeNull();
  });

  it("不是持仓页的空结果合法通过", () => {
    const r = parseVisionExtract('{"rows":[],"skipped":[]}');
    expect(r).toEqual({ rows: [], skipped: [] });
  });
});
