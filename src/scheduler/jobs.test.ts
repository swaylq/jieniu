import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { JOBS } from "./jobs";

describe("JOBS 声明自检", () => {
  it("正好 9 条，key 唯一", () => {
    expect(JOBS).toHaveLength(9);
    expect(new Set(JOBS.map((j) => j.key)).size).toBe(9);
  });

  it("每一步引用的脚本文件都真实存在", () => {
    for (const j of JOBS) {
      for (const s of j.steps) {
        expect(
          existsSync(path.join(process.cwd(), s.script)),
          `${j.key}/${s.name}: ${s.script}`,
        ).toBe(true);
      }
    }
  });

  it("用 AI 的步骤都声明了 OPENROUTER_API_KEY", () => {
    for (const j of JOBS) {
      for (const s of j.steps) {
        if (
          s.env?.OPENROUTER_MODEL ??
          /brief-recent|generate-market-digest/.test(s.script)
        ) {
          expect(s.requires, `${j.key}/${s.name}`).toContain("OPENROUTER_API_KEY");
        }
      }
    }
  });

  it("发信的步骤都声明了阿里密钥", () => {
    const mailStep = JOBS.flatMap((j) => j.steps).find((s) =>
      s.args.includes("--email"),
    );
    expect(mailStep?.requires).toEqual(
      expect.arrayContaining(["ALI_KEY", "ALI_SECRET"]),
    );
  });

  it("每条重活都标了 heavy", () => {
    const heavyKeys = JOBS.filter((j) => j.heavy)
      .map((j) => j.key)
      .sort();
    expect(heavyKeys).toEqual(
      [
        "backfill-announcements",
        "backfill-signals",
        "backfill-thesis",
        "backfill-year",
        "daily-digest",
        "daily-maintenance",
      ].sort(),
    );
  });
});
