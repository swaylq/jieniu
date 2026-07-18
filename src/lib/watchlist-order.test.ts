import { describe, it, expect } from "vitest";

import { orderWatchEntities } from "./format";

describe("orderWatchEntities", () => {
  it("orders by type (sector→company→stock→person) then name", () => {
    const out = orderWatchEntities([
      { name: "Bco", type: "COMPANY" as const },
      { name: "chip", type: "SECTOR" as const },
      { name: "Aco", type: "COMPANY" as const },
      { name: "Zman", type: "PERSON" as const },
      { name: "Xstk", type: "STOCK" as const },
    ]);
    expect(out.map((e) => e.name)).toEqual([
      "chip",
      "Aco",
      "Bco",
      "Xstk",
      "Zman",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { name: "b", type: "STOCK" as const },
      { name: "a", type: "STOCK" as const },
    ];
    const snapshot = input.map((e) => e.name);
    orderWatchEntities(input);
    expect(input.map((e) => e.name)).toEqual(snapshot);
  });
});
