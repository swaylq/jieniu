import { describe, it, expect } from "vitest";

import { personaName, PERSONA_ORDER } from "./ai";

describe("persona registry", () => {
  it("lists four masters in a stable order", () => {
    expect(PERSONA_ORDER).toEqual(["BUFFETT", "MUNGER", "LYNCH", "GRAHAM"]);
  });

  it("maps each key to a Chinese name", () => {
    expect(personaName("BUFFETT")).toBe("巴菲特");
    expect(personaName("MUNGER")).toContain("芒格");
    expect(personaName("LYNCH")).toContain("林奇");
    expect(personaName("GRAHAM")).toContain("格雷厄姆");
  });
});
