import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { feedRouter } from "./feed";

function makeCaller(db: unknown, session: unknown) {
  const createCaller = createCallerFactory(feedRouter);
  return createCaller({ db, session, headers: new Headers() } as never);
}

const SESSION = { user: { id: "u1" } };

describe("feedRouter.myFeed", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(makeCaller({}, null).myFeed()).rejects.toThrow();
  });

  it("returns empty when the user follows nothing", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const res = await makeCaller({ watchlist: { findMany } }, SESSION).myFeed();
    expect(res).toEqual({ entityIds: [], items: [] });
  });

  it("queries news for the followed entities", async () => {
    const watchlistFindMany = vi
      .fn()
      .mockResolvedValue([{ entityId: "e1" }, { entityId: "e2" }]);
    const newsFindMany = vi.fn().mockResolvedValue([{ id: "n1" }]);
    const db = {
      watchlist: { findMany: watchlistFindMany },
      newsItem: { findMany: newsFindMany },
    };

    const res = await makeCaller(db, SESSION).myFeed();

    expect(res.entityIds).toEqual(["e1", "e2"]);
    expect(res.items).toEqual([{ id: "n1" }]);
    const arg = newsFindMany.mock.calls[0]?.[0] as {
      where: { entities: { some: { entityId: { in: string[] } } } };
      take: number;
    };
    expect(arg.where.entities.some.entityId.in).toEqual(["e1", "e2"]);
    expect(arg.take).toBe(50);
  });
});
