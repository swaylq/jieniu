import { describe, it, expect } from "vitest";
import {
  ASK_HISTORY_TURNS,
  recentTurns,
  transcript,
  type AskTurn,
} from "./ask-history";

const t = (role: "user" | "assistant", content: string): AskTurn => ({
  role,
  content,
});

describe("recentTurns — 历史只带最近几轮，别让 token 滚雪球", () => {
  it("不足上限时原样返回", () => {
    const rows = [t("user", "a"), t("assistant", "b")];
    expect(recentTurns(rows)).toEqual(rows);
  });

  it("超出上限时保留最后 ASK_HISTORY_TURNS 条", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      t(i % 2 === 0 ? "user" : "assistant", `m${i}`),
    );
    const out = recentTurns(rows);
    expect(out).toHaveLength(ASK_HISTORY_TURNS);
    expect(out.at(-1)!.content).toBe("m19");
    expect(out[0]!.content).toBe(`m${20 - ASK_HISTORY_TURNS}`);
  });

  it("截断后不以 assistant 开头——半截的答话当上文会误导模型", () => {
    // 造一个「截断点正好落在 assistant 上」的序列
    const rows = Array.from({ length: 9 }, (_, i) =>
      t(i % 2 === 0 ? "assistant" : "user", `m${i}`),
    );
    const out = recentTurns(rows);
    expect(out[0]!.role).toBe("user");
    expect(out.length).toBeLessThanOrEqual(ASK_HISTORY_TURNS);
  });

  it("空历史返回空", () => {
    expect(recentTurns([])).toEqual([]);
  });
});

describe("transcript — 拼进提示词的历史文本", () => {
  it("按轮次标注说话人", () => {
    expect(transcript([t("user", "宁德怎么样"), t("assistant", "……")])).toBe(
      "用户：宁德怎么样\n解牛：……",
    );
  });
  it("没有历史时返回空串（调用方据此整段省略）", () => {
    expect(transcript([])).toBe("");
  });
});
