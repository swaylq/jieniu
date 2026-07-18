import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchQuote = vi.fn<(t: string) => Promise<unknown>>();
vi.mock("./quote", () => ({ fetchQuote: (t: string) => fetchQuote(t) }));

import { checkPriceAlerts } from "./price-alert-check";

beforeEach(() => fetchQuote.mockReset());

describe("checkPriceAlerts", () => {
  it("triggers crossed alerts, fetches each ticker once, records price+time", async () => {
    const alerts = [
      { id: "a1", ticker: "600519", direction: "above", threshold: 1500 }, // 1600 → 触发
      { id: "a2", ticker: "600519", direction: "below", threshold: 1000 }, // 1600 → 不触发
      { id: "a3", ticker: "000001", direction: "below", threshold: 12 }, // 10 → 触发
    ];
    const findMany = vi.fn().mockResolvedValue(alerts);
    const update = vi.fn().mockResolvedValue({});
    fetchQuote.mockImplementation((t) =>
      Promise.resolve(t === "600519" ? { price: 1600 } : { price: 10 }),
    );

    const res = await checkPriceAlerts({ priceAlert: { findMany, update } } as never);

    expect(res).toEqual({ checked: 3, triggered: 2 });
    // 两个不同 ticker 各拉一次（同 ticker 去重）
    expect(fetchQuote).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
    // 触发顺序 = alerts 顺序：a1（涨破）先、a3（跌破）后
    const first = update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    const second = update.mock.calls[1]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(first.where).toEqual({ id: "a1" });
    expect(first.data).toMatchObject({ active: false, triggeredPrice: 1600 });
    expect(first.data.triggeredAt).toBeInstanceOf(Date);
    expect(second.where).toEqual({ id: "a3" });
    expect(second.data).toMatchObject({ active: false, triggeredPrice: 10 });
  });

  it("skips alerts with no live quote and no-ops on an empty set", async () => {
    fetchQuote.mockResolvedValue(null);
    const update = vi.fn();
    const res = await checkPriceAlerts({
      priceAlert: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "a1", ticker: "600519", direction: "above", threshold: 1 },
          ]),
        update,
      },
    } as never);
    expect(res).toEqual({ checked: 1, triggered: 0 });
    expect(update).not.toHaveBeenCalled();

    const empty = await checkPriceAlerts({
      priceAlert: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    } as never);
    expect(empty).toEqual({ checked: 0, triggered: 0 });
  });
});
