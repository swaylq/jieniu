import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchStockDailyFlow } from "./market-daily";

/**
 * 网络类代码的边界条件靠实跑撞不全（「分页采集里空页被误当翻到底」那条教训），
 * 这里 stub 掉 `fetch` 把重试/空响应/结构不对钉死。
 */
const OK_BODY = JSON.stringify([
  {
    opendate: "2026-07-30",
    trade: "3.4900",
    changeratio: "0.0356083",
    turnover: "539.082",
    netamount: "19522575.8900",
    ratioamount: "0.13656",
  },
]);

function stub(bodies: (string | Error)[]) {
  let i = 0;
  return vi.fn(async () => {
    const b = bodies[Math.min(i++, bodies.length - 1)]!;
    if (b instanceof Error) throw b;
    return { ok: true, text: async () => b } as unknown as Response;
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchStockDailyFlow", () => {
  it("解析成功的响应", async () => {
    vi.stubGlobal("fetch", stub([OK_BODY]));
    const rows = await fetchStockDailyFlow("000812", 60, 1);
    expect(rows).toHaveLength(1);
    expect(rows![0]!.netAmount).toBeCloseTo(19522575.89, 2);
  });

  it("空响应体重试，成功后返回（拿到 200 不等于成功）", async () => {
    const f = stub(["", "", OK_BODY]);
    vi.stubGlobal("fetch", f);
    const rows = await fetchStockDailyFlow("000812", 60, 1);
    expect(f).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(1);
  });

  it("重试用尽仍失败 → null（不是空数组，调用方要能区分「没数据」和「取不到」）", async () => {
    vi.stubGlobal("fetch", stub([new Error("blocked")]));
    expect(await fetchStockDailyFlow("000812", 60, 1)).toBeNull();
  });

  it("新浪的错误对象（{__ERROR:3}）当失败处理，不当成空历史", async () => {
    vi.stubGlobal("fetch", stub(['{"__ERROR":3,"__ERRORMSG":"x"}']));
    expect(await fetchStockDailyFlow("000812", 60, 1)).toBeNull();
  });

  it("识别不了的代码不发请求", async () => {
    const f = stub([OK_BODY]);
    vi.stubGlobal("fetch", f);
    expect(await fetchStockDailyFlow("NVDA", 60, 1)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
