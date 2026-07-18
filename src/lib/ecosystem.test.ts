import { describe, it, expect } from "vitest";
import { selectPeers, type PeerCompany } from "./ecosystem";

const p = (id: string, name: string): PeerCompany => ({ id, name, ticker: null });

describe("selectPeers", () => {
  it("excludes self and dedupes", () => {
    const members = [p("self", "本公司"), p("a", "甲"), p("a", "甲重复"), p("b", "乙")];
    expect(selectPeers("self", members).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("caps at the limit, preserving order", () => {
    const members = [p("a", "甲"), p("b", "乙"), p("c", "丙")];
    expect(selectPeers("self", members, 2).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("is empty when only self is present", () => {
    expect(selectPeers("self", [p("self", "本公司")])).toEqual([]);
  });
});
