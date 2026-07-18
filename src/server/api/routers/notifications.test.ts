import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { notificationsRouter } from "./notifications";

function makeCaller(db: unknown) {
  const createCaller = createCallerFactory(notificationsRouter);
  return createCaller({
    db,
    session: { user: { id: "u1" } },
    headers: new Headers(),
  } as never);
}

describe("notificationsRouter", () => {
  it("list returns [] when nothing is followed", async () => {
    const watchlist = { findMany: vi.fn().mockResolvedValue([]) };
    const newsItem = { findMany: vi.fn() };
    const res = await makeCaller({ watchlist, newsItem }).list();
    expect(res).toEqual([]);
    expect(newsItem.findMany).not.toHaveBeenCalled();
  });

  it("list queries important news of followed entities", async () => {
    const watchlist = {
      findMany: vi
        .fn()
        .mockResolvedValue([{ entityId: "e1" }, { entityId: "e2" }]),
    };
    const rows = [{ id: "n1", title: "重大" }];
    const newsItem = { findMany: vi.fn().mockResolvedValue(rows) };
    const res = await makeCaller({ watchlist, newsItem }).list();
    expect(res).toEqual(rows);
    const arg = newsItem.findMany.mock.calls[0]?.[0] as {
      where: {
        importance: { gte: number };
        entities: { some: { entityId: { in: string[] } } };
      };
      take: number;
    };
    expect(arg.where.importance.gte).toBe(55);
    expect(arg.where.entities.some.entityId.in).toEqual(["e1", "e2"]);
    expect(arg.take).toBe(30);
  });

  it("unreadCount counts news newer than notificationsSeenAt", async () => {
    const seenAt = new Date("2026-06-01T00:00:00Z");
    const watchlist = {
      findMany: vi.fn().mockResolvedValue([{ entityId: "e1" }]),
    };
    const user = {
      findUnique: vi.fn().mockResolvedValue({ notificationsSeenAt: seenAt }),
    };
    const newsItem = { count: vi.fn().mockResolvedValue(3) };
    const res = await makeCaller({ watchlist, user, newsItem }).unreadCount();
    expect(res).toBe(3);
    const arg = newsItem.count.mock.calls[0]?.[0] as {
      where: { createdAt?: { gt: Date } };
    };
    expect(arg.where.createdAt?.gt).toBe(seenAt);
  });

  it("markSeen updates the user timestamp", async () => {
    const update = vi.fn().mockResolvedValue({});
    const res = await makeCaller({ user: { update } }).markSeen();
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
