import { describe, it, expect } from "vitest";

import { moveHighlight } from "./format";

describe("moveHighlight", () => {
  it("moves within range and wraps around", () => {
    expect(moveHighlight(0, 1, 3)).toBe(1);
    expect(moveHighlight(1, 1, 3)).toBe(2);
    expect(moveHighlight(2, 1, 3)).toBe(0); // 末项向下环回首项
    expect(moveHighlight(0, -1, 3)).toBe(2); // 首项向上环回末项
  });

  it("returns -1 when there are no items", () => {
    expect(moveHighlight(0, 1, 0)).toBe(-1);
    expect(moveHighlight(-1, -1, 0)).toBe(-1);
  });
});
