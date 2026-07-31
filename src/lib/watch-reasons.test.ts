import { describe, it, expect } from "vitest";

import {
  WATCH_REASONS,
  REASON_MAX,
  composeWatchReason,
  isWatchReasonKey,
} from "./watch-reasons";

describe("WATCH_REASONS 词表", () => {
  it("每个选项都有 key/label/hint，且 key 不重复", () => {
    const keys = WATCH_REASONS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of WATCH_REASONS) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(0);
    }
  });

  it("标签数量控制在手机一屏能扫完的范围（小哈：选三四个选择题就好）", () => {
    expect(WATCH_REASONS.length).toBeLessThanOrEqual(8);
  });

  it("isWatchReasonKey 认词表内的 key、挡住词表外的", () => {
    expect(isWatchReasonKey("growth")).toBe(true);
    expect(isWatchReasonKey("nonsense")).toBe(false);
  });
});

describe("composeWatchReason", () => {
  it("持仓说「看好」", () => {
    expect(
      composeWatchReason({ tags: ["growth", "policy"], status: "HOLDING" }),
    ).toBe("看好：业绩增长、政策受益");
  });

  it("观察说「关注」——同一组标签，两种关系语气不同", () => {
    expect(composeWatchReason({ tags: ["growth"], status: "WATCH" })).toBe(
      "关注：业绩增长",
    );
  });

  it("补充文本接在标签后面，读起来是一句话", () => {
    expect(
      composeWatchReason({
        tags: ["growth"],
        status: "HOLDING",
        extra: "新厂三季度投产。",
      }),
    ).toBe("看好：业绩增长。新厂三季度投产。");
  });

  it("只写了补充、一个标签都没选 → 就用补充本身", () => {
    expect(
      composeWatchReason({ tags: [], status: "HOLDING", extra: "赌重组" }),
    ).toBe("赌重组");
  });

  it("什么都没填 → null（不是空串：后端把 null 当没填）", () => {
    expect(composeWatchReason({ tags: [], status: "HOLDING" })).toBeNull();
    expect(
      composeWatchReason({ tags: [], status: "WATCH", extra: "   \n " }),
    ).toBeNull();
  });

  it("排序按词表、不按点击顺序——同一组选择拼出的串永远一致", () => {
    const a = composeWatchReason({
      tags: ["dividend", "growth"],
      status: "HOLDING",
    });
    const b = composeWatchReason({
      tags: ["growth", "dividend"],
      status: "HOLDING",
    });
    expect(a).toBe(b);
    expect(a).toBe("看好：业绩增长、分红稳定");
  });

  it("重复 key 只算一次", () => {
    expect(
      composeWatchReason({ tags: ["growth", "growth"], status: "HOLDING" }),
    ).toBe("看好：业绩增长");
  });

  it("词表外的 key 直接忽略，不让整条落库失败", () => {
    expect(
      composeWatchReason({ tags: ["growth", "ghost"], status: "HOLDING" }),
    ).toBe("看好：业绩增长");
  });

  it("超长补充被截到 500 字以内——后端 max(500) 会直接拒", () => {
    const out = composeWatchReason({
      tags: ["growth"],
      status: "HOLDING",
      extra: "长".repeat(800),
    });
    expect(out).not.toBeNull();
    expect(out!.length).toBe(REASON_MAX);
    // 标签部分永远保得住，被截掉的只会是自由补充
    expect(out!.startsWith("看好：业绩增长。")).toBe(true);
  });

  it("八个标签全选也远没到上限", () => {
    const out = composeWatchReason({
      tags: WATCH_REASONS.map((r) => r.key),
      status: "HOLDING",
    });
    expect(out!.length).toBeLessThan(REASON_MAX);
  });
});
