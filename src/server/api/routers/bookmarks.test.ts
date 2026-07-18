import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { bookmarksRouter } from "./bookmarks";

const SESSION = { user: { id: "u1" } };

function makeCaller(db: unknown, session: unknown = SESSION) {
  const createCaller = createCallerFactory(bookmarksRouter);
  return createCaller({ db, session, headers: new Headers() } as never);
}

describe("bookmarksRouter", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(makeCaller({}, null).list()).rejects.toThrow();
  });

  it("toggle creates a bookmark when none exists", async () => {
    const bookmark = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn(),
    };
    const res = await makeCaller({ bookmark }).toggle({ newsId: "n1" });
    expect(res).toEqual({ bookmarked: true });
    expect(bookmark.create).toHaveBeenCalledTimes(1);
    expect(bookmark.delete).not.toHaveBeenCalled();
  });

  it("toggle removes an existing bookmark", async () => {
    const bookmark = {
      findUnique: vi.fn().mockResolvedValue({ userId: "u1", newsId: "n1" }),
      create: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    };
    const res = await makeCaller({ bookmark }).toggle({ newsId: "n1" });
    expect(res).toEqual({ bookmarked: false });
    expect(bookmark.delete).toHaveBeenCalledTimes(1);
    expect(bookmark.create).not.toHaveBeenCalled();
  });

  it("list returns the bookmarked news items", async () => {
    const rows = [{ news: { id: "n1", title: "A" } }, { news: { id: "n2", title: "B" } }];
    const bookmark = { findMany: vi.fn().mockResolvedValue(rows) };
    const res = await makeCaller({ bookmark }).list();
    expect(res).toEqual([
      { id: "n1", title: "A" },
      { id: "n2", title: "B" },
    ]);
  });
});
