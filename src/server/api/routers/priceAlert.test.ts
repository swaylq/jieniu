import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { priceAlertRouter } from "./priceAlert";

const SESSION = { user: { id: "u1" } };

function makeCaller(db: unknown, session: unknown = SESSION) {
  return createCallerFactory(priceAlertRouter)({
    db,
    session,
    headers: new Headers(),
  } as never);
}

describe("priceAlertRouter.create", () => {
  it("requires auth", async () => {
    await expect(
      makeCaller({}, null).create({ entityId: "x", direction: "above", threshold: 1 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("NOT_FOUND when the entity does not exist", async () => {
    const db = { entity: { findUnique: vi.fn().mockResolvedValue(null) } };
    await expect(
      makeCaller(db).create({ entityId: "x", direction: "above", threshold: 100 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("BAD_REQUEST when the entity has no monitorable A-share ticker", async () => {
    const db = {
      entity: {
        findUnique: vi.fn().mockResolvedValue({ ticker: null, relFrom: [] }),
      },
    };
    await expect(
      makeCaller(db).create({ entityId: "x", direction: "above", threshold: 100 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("resolves the ticker from the linked STOCK and creates the alert", async () => {
    const create = vi.fn().mockResolvedValue({ id: "a1" });
    const db = {
      entity: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ticker: null, relFrom: [{ to: { ticker: "600519" } }] }),
      },
      priceAlert: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    };
    const res = await makeCaller(db).create({
      entityId: "c1",
      direction: "above",
      threshold: 1500,
    });
    expect(res).toEqual({ id: "a1", duplicated: false });
    const createArg = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(createArg.data).toMatchObject({
      userId: "u1",
      entityId: "c1",
      ticker: "600519",
      direction: "above",
      threshold: 1500,
    });
  });

  it("dedupes an identical active alert instead of creating a second", async () => {
    const create = vi.fn();
    const db = {
      entity: {
        findUnique: vi.fn().mockResolvedValue({ ticker: "600519", relFrom: [] }),
      },
      priceAlert: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ id: "existing" }),
        create,
      },
    };
    const res = await makeCaller(db).create({
      entityId: "c1",
      direction: "below",
      threshold: 1200,
    });
    expect(res).toEqual({ id: "existing", duplicated: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects once the active-alert cap is reached", async () => {
    const db = {
      entity: {
        findUnique: vi.fn().mockResolvedValue({ ticker: "600519", relFrom: [] }),
      },
      priceAlert: {
        count: vi.fn().mockResolvedValue(100),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
    await expect(
      makeCaller(db).create({ entityId: "c1", direction: "above", threshold: 1500 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("priceAlertRouter.toggle", () => {
  it("clears the triggered marks when re-activating", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await makeCaller({ priceAlert: { updateMany } }).toggle({ id: "a1", active: true });
    const arg = updateMany.mock.calls[0]?.[0] as { where: unknown; data: unknown };
    expect(arg.where).toEqual({ id: "a1", userId: "u1" });
    expect(arg.data).toEqual({ active: true, triggeredAt: null, triggeredPrice: null });
  });

  it("does not reset marks when deactivating", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await makeCaller({ priceAlert: { updateMany } }).toggle({ id: "a1", active: false });
    const arg = updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data).toEqual({ active: false });
  });
});
