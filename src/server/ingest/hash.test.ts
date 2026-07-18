import { describe, it, expect } from "vitest";
import { newsHash } from "./hash";

describe("newsHash", () => {
  it("is stable for the same inputs", () => {
    expect(newsHash("src", "u1", "t1")).toBe(newsHash("src", "u1", "t1"));
  });
  it("differs when any part differs", () => {
    expect(newsHash("src", "u1", "t1")).not.toBe(newsHash("src", "u2", "t1"));
  });
  it("returns a 40-char hex string", () => {
    expect(newsHash("a", "b")).toMatch(/^[0-9a-f]{40}$/);
  });
});
