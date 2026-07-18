import { describe, it, expect, vi } from "vitest";

// Prevent NextAuth from being instantiated through the trpc import chain.
vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { analyticsRouter } from "./analytics";

function makeCaller(db: unknown, session: unknown = null) {
  const createCaller = createCallerFactory(analyticsRouter);
  return createCaller({ db, session, headers: new Headers() } as never);
}

describe("analyticsRouter.track", () => {
  it("records an anonymous event when there is no session", async () => {
    const create = vi.fn().mockResolvedValue({});
    const res = await makeCaller({ analyticsEvent: { create } }).track({
      type: "interpret_NEUTRAL",
      newsId: "n1",
    });
    expect(res).toEqual({ ok: true });
    const arg = create.mock.calls[0]?.[0] as {
      data: { type: string; newsId: string | null; userId: string | null };
    };
    expect(arg.data.type).toBe("interpret_NEUTRAL");
    expect(arg.data.newsId).toBe("n1");
    expect(arg.data.userId).toBeNull();
  });

  it("attaches userId from the session when present", async () => {
    const create = vi.fn().mockResolvedValue({});
    await makeCaller({ analyticsEvent: { create } }, { user: { id: "u1" } }).track(
      { type: "follow", entityId: "e1" },
    );
    const arg = create.mock.calls[0]?.[0] as {
      data: { userId: string | null; entityId: string | null };
    };
    expect(arg.data.userId).toBe("u1");
    expect(arg.data.entityId).toBe("e1");
  });
});

describe("analyticsRouter.recentViews", () => {
  it("dedupes view_news (first-seen order) and returns news reordered", async () => {
    const analyticsEvent = {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { newsId: "n2" },
          { newsId: "n1" },
          { newsId: "n2" },
        ]),
    };
    const newsItem = {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: "n1", title: "A" },
          { id: "n2", title: "B" },
        ]),
    };
    const res = await makeCaller(
      { analyticsEvent, newsItem },
      { user: { id: "u1" } },
    ).recentViews();
    expect(res.map((r) => r.id)).toEqual(["n2", "n1"]);
  });
});
