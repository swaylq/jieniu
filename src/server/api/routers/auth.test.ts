import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep NextAuth + the real Aliyun client out of the import chain.
vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("~/server/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { authRouter } from "./auth";
import { sendVerificationEmail } from "~/server/email";
import { hashCode, MAX_OTP_ATTEMPTS } from "~/lib/otp";
import { __resetRateLimitStore } from "~/lib/rate-limit";

function makeCaller(db: unknown) {
  const createCaller = createCallerFactory(authRouter);
  return createCaller({ db, session: null, headers: new Headers() } as never);
}

// verifyOtpCode 在事务里执行；mock 版把回调直接以 db 自身作为 tx 运行。
const txDb = (db: Record<string, unknown>) => ({
  ...db,
  $transaction: (fn: (tx: unknown) => unknown) => fn(db),
});

// 限流状态是模块级、跨用例累积——每个用例前清零以隔离。
beforeEach(() => __resetRateLimitStore());

describe("authRouter.requestOtp", () => {
  it("stores a hashed, email-salted code and sends the email", async () => {
    const create = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({});
    const db = { verificationToken: { create, deleteMany } };

    const res = await makeCaller(db).requestOtp({ email: "A@B.com" });

    expect(res.sent).toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { identifier: "a@b.com" },
    });
    const arg = create.mock.calls[0]?.[0] as
      | { data: { identifier: string; token: string } }
      | undefined;
    expect(arg?.data.identifier).toBe("a@b.com");
    expect(arg?.data.token).toHaveLength(64);
    expect(arg?.data.token).not.toContain("@");
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
  });
});

describe("authRouter.verifyOtp", () => {
  it("rejects an unknown or wrong code", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = txDb({ verificationToken: { findFirst } });
    const res = await makeCaller(db).verifyOtp({
      email: "a@b.com",
      code: "000000",
    });
    expect(res.ok).toBe(false);
  });

  it("accepts a valid code, consumes it, and upserts the user", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      identifier: "a@b.com",
      token: hashCode("a@b.com:123456"),
      expires: new Date(Date.now() + 60_000),
    });
    const deleteMany = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({ id: "u1", email: "a@b.com" });
    const db = txDb({
      verificationToken: { findFirst, deleteMany },
      user: { upsert },
    });

    const res = await makeCaller(db).verifyOtp({
      email: "a@b.com",
      code: "123456",
    });

    expect(res).toEqual({ ok: true, userId: "u1" });
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("rejects an expired code", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      identifier: "a@b.com",
      token: hashCode("a@b.com:123456"),
      expires: new Date(Date.now() - 1),
    });
    const db = txDb({ verificationToken: { findFirst } });
    const res = await makeCaller(db).verifyOtp({
      email: "a@b.com",
      code: "123456",
    });
    expect(res.ok).toBe(false);
  });

  it("increments attempts on a wrong code below the cap", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      identifier: "a@b.com",
      token: hashCode("a@b.com:123456"),
      expires: new Date(Date.now() + 60_000),
      attempts: 0,
    });
    const update = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({});
    const db = txDb({ verificationToken: { findFirst, update, deleteMany } });

    const res = await makeCaller(db).verifyOtp({
      email: "a@b.com",
      code: "999999",
    });

    expect(res.ok).toBe(false);
    expect(update).toHaveBeenCalledTimes(1); // 记一次失败
    expect(deleteMany).not.toHaveBeenCalled(); // 未到上限，不作废
  });

  it("invalidates the code once the attempt cap is hit", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      identifier: "a@b.com",
      token: hashCode("a@b.com:123456"),
      expires: new Date(Date.now() + 60_000),
      attempts: MAX_OTP_ATTEMPTS - 1,
    });
    const update = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({});
    const db = txDb({ verificationToken: { findFirst, update, deleteMany } });

    const res = await makeCaller(db).verifyOtp({
      email: "a@b.com",
      code: "999999",
    });

    expect(res.ok).toBe(false);
    expect(deleteMany).toHaveBeenCalledTimes(1); // 作废该码
    expect(update).not.toHaveBeenCalled();
  });
});
