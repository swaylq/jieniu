import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchStockDailyFlow,
  fetchStockDailyFlowResult,
  looksBanned,
} from "./market-daily";

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
    return { ok: true, status: 200, text: async () => b } as unknown as Response;
  });
}

/** 新浪封禁页：HTTP 456 + 中文 HTML（2026-08-27 实测原文节选）。 */
const BAN_BODY = `<!Doctype html><html><head><title>拒绝访问</title></head><body>
<h1>拒绝访问</h1><p>你的 IP 存在异常访问(例如: 爬虫/攻击/探测 等), 已被新浪安全部门封禁.</p>
<p>停止异常访问一段时间后(5~60分钟)会自动解封, 请耐心等待.</p></body></html>`;

function stubStatus(status: number, body: string) {
  return vi.fn(
    async () =>
      ({ ok: status >= 200 && status < 300, status, text: async () => body }) as unknown as Response,
  );
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

describe("封禁识别（2026-08-24~27 连挂四天的根因）", () => {
  it("looksBanned 认 HTTP 456", () => {
    expect(looksBanned(456, "")).toBe(true);
  });

  it("looksBanned 也认正文里的封禁字样（万一状态码变了）", () => {
    expect(looksBanned(200, BAN_BODY)).toBe(true);
    expect(looksBanned(200, "<h1>拒绝访问</h1>")).toBe(true);
  });

  it("正常响应不会被误判成封禁", () => {
    expect(looksBanned(200, OK_BODY)).toBe(false);
    expect(looksBanned(200, '{"__ERROR":3}')).toBe(false);
  });

  it("被封时返回 banned，而不是笼统的 null —— 这两件事的处理方式完全相反", async () => {
    vi.stubGlobal("fetch", stubStatus(456, BAN_BODY));
    const r = await fetchStockDailyFlowResult("000812", 60, 1);
    expect(r.kind).toBe("banned");
  });

  it("被封时**不重试**：重试只会延长封禁", async () => {
    const f = stubStatus(456, BAN_BODY);
    vi.stubGlobal("fetch", f);
    await fetchStockDailyFlowResult("000812", 60, 1, 3);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("源说没有这只股的数据 = empty，不是 miss（退市壳不该计进故障数）", async () => {
    vi.stubGlobal("fetch", stub(['{"__ERROR":3}']));
    expect((await fetchStockDailyFlowResult("000812", 60, 1)).kind).toBe("empty");
  });

  it("空数组也是 empty 不是 miss", async () => {
    vi.stubGlobal("fetch", stub(["[]"]));
    expect((await fetchStockDailyFlowResult("000812", 60, 1)).kind).toBe("empty");
  });

  it("超时/网络错重试用尽 = miss", async () => {
    vi.stubGlobal("fetch", stub([new Error("boom")]));
    expect((await fetchStockDailyFlowResult("000812", 60, 1, 2)).kind).toBe("miss");
  });

  it("旧签名兼容：被封也返回 null（老调用方不受影响）", async () => {
    vi.stubGlobal("fetch", stubStatus(456, BAN_BODY));
    expect(await fetchStockDailyFlow("000812", 60, 1)).toBeNull();
  });
});
