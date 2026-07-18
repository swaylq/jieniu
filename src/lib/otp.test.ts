import { describe, it, expect } from "vitest";
import { generateCode, hashCode, OTP_TTL_MS } from "./otp";

describe("generateCode", () => {
  it("produces a 6-digit numeric string", () => {
    for (let i = 0; i < 30; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("hashCode", () => {
  it("is stable, differs by input, and hides the plaintext", () => {
    expect(hashCode("a@b.com:123456")).toBe(hashCode("a@b.com:123456"));
    expect(hashCode("a@b.com:123456")).not.toBe(hashCode("a@b.com:654321"));
    expect(hashCode("a@b.com:123456")).not.toContain("123456");
    expect(hashCode("x")).toHaveLength(64);
  });
});

describe("OTP_TTL_MS", () => {
  it("is 10 minutes", () => {
    expect(OTP_TTL_MS).toBe(600_000);
  });
});
