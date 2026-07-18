import { describe, it, expect } from "vitest";
import {
  HOT_SECTORS,
  HOT_UNIVERSE_TARGET,
  HOT_SECTOR_NAMES,
  dedupeHotStocks,
  hotSectorOrder,
} from "./hot-universe";

describe("HOT_SECTORS 定义", () => {
  it("板块代码唯一、名称唯一、cap 为正、board 形如 BKxxxx", () => {
    const boards = HOT_SECTORS.map((s) => s.board);
    const names = HOT_SECTORS.map((s) => s.name);
    expect(new Set(boards).size).toBe(boards.length);
    expect(new Set(names).size).toBe(names.length);
    expect(HOT_SECTORS.every((s) => s.cap > 0)).toBe(true);
    expect(HOT_SECTORS.every((s) => /^BK\d{4}$/.test(s.board))).toBe(true);
  });

  it("目标规模落在「一两百只」（张楚寒：热门股约一两百只）", () => {
    expect(HOT_UNIVERSE_TARGET).toBeGreaterThanOrEqual(120);
    expect(HOT_UNIVERSE_TARGET).toBeLessThanOrEqual(220);
  });

  it("覆盖 A股核心主线（AI/半导体/新能源/军工/医药/白酒等）", () => {
    for (const key of ["人工智能", "半导体", "新能源", "军工", "医药", "白酒"]) {
      expect(HOT_SECTOR_NAMES).toContain(key);
    }
  });
});

describe("dedupeHotStocks", () => {
  it("同一股票跨多个热门板块只计一次，并合并所属板块、保留首个为 primary", () => {
    const rows = [
      { ticker: "300750", name: "宁德时代", sector: "新能源" },
      { ticker: "300750", name: "宁德时代", sector: "储能" },
      { ticker: "600519", name: "贵州茅台", sector: "白酒" },
    ];
    const out = dedupeHotStocks(rows);
    expect(out).toHaveLength(2);
    const catl = out.find((o) => o.ticker === "300750")!;
    expect(catl.sectors).toEqual(["新能源", "储能"]);
    expect(catl.primarySector).toBe("新能源");
  });

  it("忽略空 ticker", () => {
    expect(dedupeHotStocks([{ ticker: "", name: "x", sector: "y" }])).toHaveLength(0);
  });
});

describe("hotSectorOrder", () => {
  it("按 curated 顺序排序，未列入的排最后", () => {
    expect(hotSectorOrder("人工智能")).toBe(0);
    expect(hotSectorOrder("人工智能")).toBeLessThan(hotSectorOrder("白酒"));
    expect(hotSectorOrder("房地产")).toBe(HOT_SECTOR_NAMES.length);
  });
});
