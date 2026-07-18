import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { userThesisRouter } from "./user-thesis";

const SESSION = { user: { id: "u1" } };
function makeCaller(db: unknown) {
  const createCaller = createCallerFactory(userThesisRouter);
  return createCaller({ db, session: SESSION, headers: new Headers() } as never);
}

describe("userThesis.adopt", () => {
  it("throws when the entity has no base thesis", async () => {
    const db = { thesis: { findUnique: vi.fn().mockResolvedValue(null) } };
    await expect(makeCaller(db).adopt({ entityId: "e1" })).rejects.toThrow();
  });

  it("snapshots base dimensions into a user thesis with safe defaults", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      thesis: {
        findUnique: vi.fn().mockResolvedValue({
          dimensions: [{ key: "订单", watch: "w", bull: "b", bear: "x" }],
          model: "deepseek",
        }),
      },
      userThesis: { upsert },
    };
    await makeCaller(db).adopt({ entityId: "e1", reason: "  长期看好  " });
    const arg = upsert.mock.calls[0]?.[0] as {
      create: { dimensions: unknown[]; reason: string | null; baseModel: string | null };
    };
    expect(arg.create.dimensions[0]).toMatchObject({
      key: "订单",
      sensitivity: "normal",
      muted: false,
      priority: false,
      source: "base",
    });
    expect(arg.create.reason).toBe("长期看好"); // trimmed
    expect(arg.create.baseModel).toBe("deepseek");
  });
});

describe("userThesis.update", () => {
  it("normalizes incoming dimensions before persisting", async () => {
    const update = vi.fn().mockResolvedValue({});
    const db = { userThesis: { update } };
    await makeCaller(db).update({
      entityId: "e1",
      reason: "core holding",
      dimensions: [{ key: "订单", sensitivity: "high", priority: true }],
    });
    const arg = update.mock.calls[0]?.[0] as {
      data: { dimensions: unknown[]; reason: string | null };
    };
    expect(arg.data.dimensions[0]).toMatchObject({
      key: "订单",
      sensitivity: "high",
      priority: true,
      muted: false,
      source: "user",
    });
    expect(arg.data.reason).toBe("core holding");
  });
});
