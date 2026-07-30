import { describe, it, expect, vi, afterEach } from "vitest";

import {
  marginSignal,
  consensusSignal,
  unlockSignal,
  commodityToSignal,
  taiwanRevenueToSignal,
  populateSignals,
  populateSectorSignals,
} from "./signals";

describe("marginSignal (融资余额)", () => {
  it("builds a margin signal with balance in 亿 and float ratio", () => {
    const s = marginSignal({
      SCODE: "600519",
      RZYE: 772000000,
      RZYEZB: 6.13,
      DATE: "2026-07-23 00:00:00",
    });
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("margin");
    expect(s!.label).toContain("7.72亿");
    expect(s!.label).toContain("6.13%");
    expect(s!.numValue).toBe(6.13);
    expect(s!.asOf.toISOString()).toBe("2026-07-22T16:00:00.000Z"); // 2026-07-23 CST 零点
  });
  it("returns null without a balance", () => {
    expect(marginSignal({ SCODE: "600519", DATE: "2026-07-23 00:00:00" })).toBeNull();
  });
});

describe("consensusSignal (一致预期，合规脱敏)", () => {
  it("keeps coverage/rating/EPS but NEVER the target price", () => {
    // 源实际返回里带目标价字段（DEC_AIMPRICEMIN/MAX）；用变量传入（ConsensusRow 类型不含它们，
    // 但运行时对象带着——正好验证「即便源给了目标价，也绝不泄漏到 label/detail」）。
    const raw = {
      SECURITY_CODE: "300750",
      RATING_ORG_NUM: 32,
      RATING_BUY_NUM: 26,
      RATING_ADD_NUM: 6,
      RATING_NEUTRAL_NUM: 0,
      EPS1: 15.61,
      YEAR1: "2025",
      DEC_AIMPRICEMIN: 320,
      DEC_AIMPRICEMAX: 380,
    };
    const s = consensusSignal(raw);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("consensus");
    expect(s!.label).toContain("32家");
    expect(s!.numValue).toBe(32);
    // 合规铁律②：目标价一律不出现在 label / detail 里
    const blob = s!.label + JSON.stringify(s!.detail);
    expect(blob).not.toContain("320");
    expect(blob).not.toContain("380");
    expect(blob.toLowerCase()).not.toContain("aimprice");
  });
  it("returns null when no institution covers it", () => {
    expect(consensusSignal({ SECURITY_CODE: "300750", RATING_ORG_NUM: 0 })).toBeNull();
  });
});

describe("unlockSignal (下次限售解禁，前瞻)", () => {
  it("builds an unlock signal from a future free date and ratio", () => {
    const s = unlockSignal({
      SECURITY_CODE: "301297",
      FREE_DATE: "2026-08-17 00:00:00",
      FREE_RATIO: 0.9,
      FREE_SHARES_TYPE: "定向增发机构配售股份",
    });
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("unlock");
    expect(s!.label).toContain("0.9%");
    expect(s!.numValue).toBe(0.9);
    expect(s!.asOf.toISOString()).toBe("2026-08-16T16:00:00.000Z"); // 2026-08-17 CST 零点
  });
  it("returns null without a free date", () => {
    expect(unlockSignal({ SECURITY_CODE: "301297", FREE_RATIO: 0.9 })).toBeNull();
  });
});

describe("commodityToSignal (产业链价格→板块信号)", () => {
  it("builds a commodity signal with price and change direction", () => {
    const s = commodityToSignal("碳酸锂", 144780, -0.56, "元/吨");
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("commodity");
    expect(s!.label).toContain("碳酸锂");
    expect(s!.label).toContain("144780");
    expect(s!.label).toContain("-0.56%");
    expect(s!.numValue).toBe(-0.56);
  });
  it("returns null for a non-positive price", () => {
    expect(commodityToSignal("碳酸锂", 0, 1, "元/吨")).toBeNull();
  });
});

describe("taiwanRevenueToSignal (台股月营收→半导体先行指标)", () => {
  it("formats TSMC revenue (千元→亿台币) with YoY", () => {
    const s = taiwanRevenueToSignal("台积电", 442679969, 67.9);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("overseas");
    expect(s!.label).toContain("台积电");
    expect(s!.label).toContain("同比");
    expect(s!.numValue).toBe(67.9);
  });
  it("returns null without revenue", () => {
    expect(taiwanRevenueToSignal("台积电", 0, 10)).toBeNull();
  });
});

// 静默故障硬化（7-24 教训「永不裸 catch{}，至少 console.error」）：
// populateSignals/populateSectorSignals 的逐类 try/catch 原为裸 `catch {}`，某源端点变了会 100% 失败却零日志痕迹。
// 要求：任一类抓取失败时，跳过该类并**记录一条含 kind 名的 console.error**（不中断其它类）。
function mockDb(entities: unknown[]) {
  return {
    entity: { findMany: vi.fn().mockResolvedValue(entities) },
    entitySignal: { upsert: vi.fn() },
  } as never;
}

describe("populateSignals — 源失败记日志不静默", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs each kind's skip when upstream fetch throws, and still returns zeros (不抛)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await populateSignals(mockDb([{ id: "e1", ticker: "600519" }]));

    expect(res).toEqual({ margin: 0, consensus: 0, unlock: 0 });
    const logged = err.mock.calls.map((c) => c.map(String).join(" ")).join(" | ");
    expect(logged).toContain("margin");
    expect(logged).toContain("consensus");
    expect(logged).toContain("unlock");
  });
});

describe("populateSectorSignals — 源失败记日志不静默", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs commodity/overseas skips when upstream fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await populateSectorSignals(
      mockDb([
        { id: "s1", name: "半导体" },
        { id: "s2", name: "新能源" },
        { id: "s3", name: "光伏" },
      ]),
    );

    expect(res).toEqual({ commodity: 0, overseas: 0 });
    const logged = err.mock.calls.map((c) => c.map(String).join(" ")).join(" | ");
    expect(logged).toContain("commodity");
    expect(logged).toContain("overseas");
  });
});
