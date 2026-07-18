import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, isValidPassword } from "./password";

describe("isValidPassword", () => {
  it("requires 8–128 chars", () => {
    expect(isValidPassword("1234567")).toBe(false);
    expect(isValidPassword("12345678")).toBe(true);
    expect(isValidPassword("a".repeat(128))).toBe(true);
    expect(isValidPassword("a".repeat(129))).toBe(false);
    expect(isValidPassword(123)).toBe(false);
    expect(isValidPassword(null)).toBe(false);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("round-trips: correct password verifies, wrong fails", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });
  it("salts: same password hashes differently each time", async () => {
    const a = await hashPassword("samePassword1");
    const b = await hashPassword("samePassword1");
    expect(a).not.toBe(b);
    expect(await verifyPassword("samePassword1", a)).toBe(true);
    expect(await verifyPassword("samePassword1", b)).toBe(true);
  });
  it("rejects malformed / empty stored hashes", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", undefined)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$aa$bb")).toBe(false);
    expect(await verifyPassword("x", "scrypt$onlytwo")).toBe(false);
  });
});
