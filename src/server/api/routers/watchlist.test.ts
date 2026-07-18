import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { watchlistRouter } from "./watchlist";

function makeCaller(db: unknown, session: unknown) {
  const createCaller = createCallerFactory(watchlistRouter);
  return createCaller({ db, session, headers: new Headers() } as never);
}

const SESSION = { user: { id: "u1" } };

describe("watchlistRouter", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(makeCaller({}, null).follow({ entityId: "e1" })).rejects.toThrow();
  });

  it("follow upserts a row for the session user", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const res = await makeCaller({ watchlist: { upsert } }, SESSION).follow({
      entityId: "e1",
    });
    expect(res).toEqual({ following: true });
    const arg = upsert.mock.calls[0]?.[0] as {
      create: { userId: string; entityId: string };
    };
    expect(arg.create).toEqual({ userId: "u1", entityId: "e1" });
  });

  it("unfollow deletes the row", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const res = await makeCaller({ watchlist: { deleteMany } }, SESSION).unfollow({
      entityId: "e1",
    });
    expect(res).toEqual({ following: false });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", entityId: "e1" },
    });
  });

  it("followMany bulk-inserts for the session user, skipping duplicates", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const res = await makeCaller(
      { watchlist: { createMany } },
      SESSION,
    ).followMany({ entityIds: ["e1", "e2"] });
    expect(res).toEqual({ count: 2 });
    const arg = createMany.mock.calls[0]?.[0] as {
      data: { userId: string; entityId: string }[];
      skipDuplicates: boolean;
    };
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toEqual([
      { userId: "u1", entityId: "e1" },
      { userId: "u1", entityId: "e2" },
    ]);
  });

  it("isFollowing returns true when a row exists, false otherwise", async () => {
    const present = makeCaller(
      { watchlist: { findUnique: vi.fn().mockResolvedValue({ userId: "u1" }) } },
      SESSION,
    );
    expect(await present.isFollowing({ entityId: "e1" })).toBe(true);
    const absent = makeCaller(
      { watchlist: { findUnique: vi.fn().mockResolvedValue(null) } },
      SESSION,
    );
    expect(await absent.isFollowing({ entityId: "e1" })).toBe(false);
  });
});
