import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchDailyBars } from "./kline";

/**
 * 主备源顺序的行为测试（stub 掉 fetch，不打网络）。
 *
 * 为什么要测顺序：东财 `push2his` 对本节点实测 **0/8 全败**（96ms 快速失败），
 * 新浪 8/8 全成。原来把东财放主源，等于每次都白付一次失败往返。
 * 顺序是会被随手改回去的那类东西，用测试钉住。
 */

const SINA_BODY = JSON.stringify([
  { day: "2026-07-24", close: "10.00" },
  { day: "2026-07-27", close: "10.50" },
]);
const EM_BODY = JSON.stringify({
  data: { klines: ["2026-07-24,10.00,0.00", "2026-07-27,10.50,5.00"] },
});

function stubFetch(handler: (url: string) => { ok: boolean; body: string }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(url);
    const r = handler(url);
    return Promise.resolve({
      ok: r.ok,
      json: () => Promise.resolve(JSON.parse(r.body)),
    } as Response);
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchDailyBars 主备源顺序", () => {
  it("先打新浪——它是实测可用的那个源", async () => {
    const calls = stubFetch(() => ({ ok: true, body: SINA_BODY }));
    const bars = await fetchDailyBars("600519");
    expect(calls[0]).toContain("finance.sina.com.cn");
    expect(bars).toHaveLength(2);
  });

  it("新浪成功就**不打**东财——不为已知会失败的源付一次往返", async () => {
    const calls = stubFetch(() => ({ ok: true, body: SINA_BODY }));
    await fetchDailyBars("600519");
    expect(calls.some((u) => u.includes("eastmoney"))).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("新浪挂了才回退东财，且结果可用", async () => {
    const calls = stubFetch((url) =>
      url.includes("sina")
        ? { ok: false, body: "{}" }
        : { ok: true, body: EM_BODY },
    );
    const bars = await fetchDailyBars("600519");
    expect(calls[0]).toContain("sina");
    expect(calls[1]).toContain("push2his.eastmoney.com");
    expect(bars).toHaveLength(2);
    expect(bars[1]!.changePct).toBe(5);
  });

  it("两源都挂返回空数组，不抛——调用方据此不渲染该模块", async () => {
    stubFetch(() => ({ ok: false, body: "{}" }));
    await expect(fetchDailyBars("600519")).resolves.toEqual([]);
  });

  it("新浪抛异常也要继续回退东财，不能整块失败", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      if (url.includes("sina")) return Promise.reject(new Error("fetch failed"));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(JSON.parse(EM_BODY)),
      } as Response);
    });
    const bars = await fetchDailyBars("600519");
    expect(bars).toHaveLength(2);
    expect(calls[1]).toContain("eastmoney");
  });

  it("非 A 股代码两源都构造不出参数 → 空数组", async () => {
    stubFetch(() => ({ ok: true, body: SINA_BODY }));
    await expect(fetchDailyBars("AAPL")).resolves.toEqual([]);
  });
});
