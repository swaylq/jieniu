import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAllFlows, PAGE_SIZE } from "./market-flow";

/**
 * 分页 + 重试的行为测试（stub fetch，不打网络）。
 *
 * 这里钉住的是一个实跑才暴露的 bug：东财是**间歇封锁**，被封的页返回空响应体。
 * 最初把「连续空页」当成「翻到底了」直接 break，结果 5884 只股只采到 1100 只，
 * 而且 `fetched` 看着像成功——板块统计会静默地只覆盖三分之一。
 */

const row = (i: number) => ({
  f12: String(600000 + i),
  f14: `股${i}`,
  f2: 10,
  f3: 1,
  f62: 100,
  f184: 1,
});
const page = (n: number, total: number) =>
  JSON.stringify({ data: { total, diff: Array.from({ length: n }, (_, i) => row(i)) } });

function stub(handler: (pn: number) => string) {
  const seen: number[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    const pn = Number(/[?&]pn=(\d+)/.exec(url)?.[1] ?? 0);
    seen.push(pn);
    return Promise.resolve({ ok: true, text: () => Promise.resolve(handler(pn)) } as Response);
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchAllFlows 分页", () => {
  it("按 total 算出该翻多少页，全部取回", async () => {
    const total = PAGE_SIZE * 3;
    stub(() => page(PAGE_SIZE, total));
    const r = await fetchAllFlows(1);
    expect(r.rows).toHaveLength(total);
    expect(r.failedPages).toBe(0);
  });

  it("中间某页被封（空响应）不能当成翻到底——要跳过它继续翻完", async () => {
    const total = PAGE_SIZE * 4;
    const seen = stub((pn) => (pn === 2 ? "" : page(PAGE_SIZE, total)));
    const r = await fetchAllFlows(1);
    expect(r.failedPages).toBe(1);
    // 第 2 页丢了，但 3/4 页必须继续取
    expect(seen).toContain(3);
    expect(seen).toContain(4);
    expect(r.rows).toHaveLength(PAGE_SIZE * 3);
  });

  it("连续两页被封也要继续——间歇封锁经常连着来", async () => {
    const total = PAGE_SIZE * 5;
    const seen = stub((pn) => (pn === 2 || pn === 3 ? "" : page(PAGE_SIZE, total)));
    const r = await fetchAllFlows(1);
    expect(r.failedPages).toBe(2);
    expect(seen).toContain(5);
    expect(r.rows).toHaveLength(PAGE_SIZE * 3);
  });

  it("页内有停牌股被过滤掉，不能当成翻到底——解析后的条数 ≠ 原始条数", async () => {
    // 实跑踩到的第二个坑：一页 100 条原始数据里混着停牌股（字段是 "-"），
    // parseFlowRows 会丢掉它们 → 解析出 97 条。拿 97 跟 100 比就误判成最后一页，
    // 5884 只股只采到 2597 只，而 failedPages 还是 0，看起来完全正常。
    const total = PAGE_SIZE * 3;
    const halted = JSON.stringify({
      data: {
        total,
        diff: [
          ...Array.from({ length: PAGE_SIZE - 3 }, (_, i) => row(i)),
          { f12: "600001", f14: "停牌1", f2: "-", f3: "-", f62: "-" },
          { f12: "600002", f14: "停牌2", f2: "-", f3: "-", f62: "-" },
          { f12: "600003", f14: "停牌3", f2: "-", f3: "-", f62: "-" },
        ],
      },
    });
    const seen = stub((pn) => (pn === 1 ? halted : page(PAGE_SIZE, total)));
    const r = await fetchAllFlows(1);
    expect(Math.max(...seen)).toBe(3); // 必须继续翻到第 3 页
    expect(r.rows).toHaveLength(PAGE_SIZE - 3 + PAGE_SIZE * 2);
  });

  it("最后一页不满即停，不多打无谓请求", async () => {
    const total = PAGE_SIZE * 2 + 7;
    const seen = stub((pn) => page(pn === 3 ? 7 : PAGE_SIZE, total));
    const r = await fetchAllFlows(1);
    expect(r.rows).toHaveLength(total);
    expect(Math.max(...seen)).toBe(3);
  });

  it("第一页就拿不到 → 空结果并如实报失败，不假装成功", async () => {
    stub(() => "");
    const r = await fetchAllFlows(1);
    expect(r.rows).toEqual([]);
    expect(r.failedPages).toBeGreaterThan(0);
    expect(r.total).toBe(0);
  });

  it("被封的页会重试（同一页被打多次）", async () => {
    let hit = 0;
    vi.stubGlobal("fetch", (url: string) => {
      const pn = Number(/[?&]pn=(\d+)/.exec(url)?.[1] ?? 0);
      if (pn === 1) hit++;
      // 第 1 页前两次空，第三次成功
      const body = pn === 1 && hit <= 2 ? "" : page(3, 3);
      return Promise.resolve({ ok: true, text: () => Promise.resolve(body) } as Response);
    });
    const r = await fetchAllFlows(1);
    expect(hit).toBeGreaterThan(1);
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
