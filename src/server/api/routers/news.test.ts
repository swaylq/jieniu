import { describe, it, expect, vi } from "vitest";

// Prevent NextAuth from being instantiated through the trpc import chain.
vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { newsRouter } from "./news";

function makeCaller(db: unknown) {
  const createCaller = createCallerFactory(newsRouter);
  return createCaller({ db, session: null, headers: new Headers() } as never);
}

describe("newsRouter.byId", () => {
  it("fetches a news item with its related entities", async () => {
    const row = {
      id: "n1",
      title: "某公司重大重组",
      entities: [{ entity: { id: "e1", name: "中芯国际", type: "COMPANY" } }],
    };
    const findUnique = vi.fn().mockResolvedValue(row);
    const res = await makeCaller({ newsItem: { findUnique } }).byId({
      id: "n1",
    });
    expect(res).toEqual(row);
    const arg = findUnique.mock.calls[0]?.[0] as { where: { id: string } };
    expect(arg.where.id).toBe("n1");
  });
});

describe("newsRouter.important", () => {
  it("returns high-importance news, threshold 55, capped at 10", async () => {
    const rows = [{ id: "n1", title: "重大重组", tier: "PRIMARY" }];
    const findMany = vi.fn().mockResolvedValue(rows);
    const res = await makeCaller({ newsItem: { findMany } }).important();
    expect(res).toEqual(rows);
    const arg = findMany.mock.calls[0]?.[0] as {
      where: { importance: { gte: number } };
      take: number;
    };
    expect(arg.where.importance.gte).toBe(55);
    expect(arg.take).toBe(10);
  });
});
