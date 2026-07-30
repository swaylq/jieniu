import { describe, it, expect } from "vitest";
import { createStreamGuard } from "./ask-guard";

/** 按给定分块喂进去，返回每一步的状态。 */
function feed(chunks: string[]) {
  const g = createStreamGuard();
  const steps = chunks.map((c) => g.push(c));
  return { steps, final: g.finish() };
}

describe("createStreamGuard — 流式也不能把不合规内容摆到用户眼前", () => {
  it("干净内容一路放行", () => {
    const { steps, final } = feed(["公司上半年", "净利同比增长 42%，", "属于事实陈述。"]);
    expect(steps.every((s) => !s.blocked)).toBe(true);
    expect(final.blocked).toBe(false);
    expect(final.text).toContain("净利同比增长");
  });

  it("红线被拆在两块之间也能抓到（这正是流式最容易漏的地方）", () => {
    // 「目标价」被切成「目标」+「价 120 元」，单看任何一块都不违规
    const { steps } = feed(["综合来看，我给出的目标", "价 120 元。"]);
    expect(steps[0]!.blocked).toBe(false);
    expect(steps[1]!.blocked).toBe(true);
    expect(steps[1]!.hit).toBe("价格点位");
  });

  it("命中当下那一块就拦，不等整段写完", () => {
    const { steps } = feed(["建议立即买入", "，后面还有很多话", "还有更多"]);
    expect(steps[0]!.blocked).toBe(true);
    expect(steps[0]!.hit).toBe("买卖建议");
  });

  it("拦截后锁死——上游 abort 前的在途块不能把状态翻回去", () => {
    const g = createStreamGuard();
    expect(g.push("建议立即买入").blocked).toBe(true);
    const later = g.push("这是一段完全干净的补充说明");
    expect(later.blocked).toBe(true);
    expect(later.text).toBe("建议立即买入"); // 越线之后的内容不再累积
  });

  it("收尾兜底：逐块都没抓到时整段再扫一次", () => {
    const g = createStreamGuard();
    g.push("稳"); // 单块无害
    g.push("赚不赔"); // 拼起来才是「稳赚」
    expect(g.finish().blocked).toBe(true);
    expect(g.finish().hit).toBe("收益承诺");
  });

  it("收益承诺 / 仓位指令都在拦截范围", () => {
    expect(feed(["满仓干"]).steps[0]!.hit).toBe("仓位指令");
    expect(feed(["这只票必涨"]).steps[0]!.hit).toBe("收益承诺");
  });
});
