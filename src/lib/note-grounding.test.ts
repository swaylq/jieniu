import { describe, it, expect } from "vitest";
import {
  buildGroundingPrompt,
  parseGroundingResponse,
  type GroundingItem,
} from "./note-grounding";

// 夹具取自 2026-08-03 线上真实产出（潞截图那条）与同日真实事实。
const REAL: GroundingItem[] = [
  {
    subject: "国盾量子",
    facts: [
      "本周，A股“光”和“芯”新股都来了",
      "闯关科创板！频准激光全链条自研破局 发力量子与半导体赛道",
    ],
    note: "光量子赛道新股密集上市，公司作为产业链龙头或受益于行业关注度提升",
  },
  {
    subject: "东山精密",
    facts: ["东山精密：累计回购公司股份255200股"],
    note: "累计回购25.52万股，管理层用真金白银表态",
  },
];

describe("buildGroundingPrompt", () => {
  const p = buildGroundingPrompt(REAL);

  it("每条都带编号、主体、它自己的事实和待核归因", () => {
    expect(p).toContain("1. 标的：国盾量子");
    expect(p).toContain("2. 标的：东山精密");
    expect(p).toContain("- 本周，A股“光”和“芯”新股都来了");
    expect(p).toContain("归因：光量子赛道新股密集上市");
  });

  it("没有事实的条目明写「（无）」，不留空让模型猜", () => {
    expect(buildGroundingPrompt([{ subject: "X", facts: [], note: "涨了" }])).toContain("（无）");
  });
});

describe("parseGroundingResponse — 兜底一律放行", () => {
  it("解析出显式 false 的那条", () => {
    const v = parseGroundingResponse(
      JSON.stringify({
        verdicts: [
          { i: 1, ok: false, why: "事实里没有「光量子」" },
          { i: 2, ok: true, why: "" },
        ],
      }),
      2,
    );
    expect(v[0]!.ok).toBe(false);
    expect(v[0]!.why).toContain("光量子");
    expect(v[1]!.ok).toBe(true);
  });

  it("模型漏答的条目当通过——核查器漏答不该把内容删掉", () => {
    const v = parseGroundingResponse(JSON.stringify({ verdicts: [{ i: 2, ok: false }] }), 3);
    expect(v.map((x) => x.ok)).toEqual([true, false, true]);
  });

  it("非 JSON / 空响应 / 结构不对 → 全部放行", () => {
    for (const raw of ["", "模型挂了", "{}", '{"verdicts":"x"}', "```json\n{}\n```"]) {
      expect(parseGroundingResponse(raw, 2).every((x) => x.ok)).toBe(true);
    }
  });

  it("越界下标不影响别人", () => {
    const v = parseGroundingResponse(
      JSON.stringify({ verdicts: [{ i: 0, ok: false }, { i: 9, ok: false }] }),
      2,
    );
    expect(v.every((x) => x.ok)).toBe(true);
  });

  it("ok 不是布尔 false（缺字段 / 字符串）时不判否——只认显式 false", () => {
    const v = parseGroundingResponse(
      JSON.stringify({ verdicts: [{ i: 1 }, { i: 2, ok: "false" }] }),
      2,
    );
    expect(v.every((x) => x.ok)).toBe(true);
  });

  it("带围栏的 JSON 照样解析", () => {
    const v = parseGroundingResponse(
      '```json\n{"verdicts":[{"i":1,"ok":false,"why":"编的"}]}\n```',
      1,
    );
    expect(v[0]!.ok).toBe(false);
  });
});
