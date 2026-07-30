import { describe, it, expect } from "vitest";
import { splitSseFrames, parseSseFrame } from "./sse";

describe("splitSseFrames — 半截帧必须留到下一轮", () => {
  it("切出完整帧，尾部不完整的留在 rest", () => {
    const { frames, rest } = splitSseFrames(
      "event: delta\ndata: {}\n\nevent: delta\ndata: {\"tex",
    );
    expect(frames).toEqual(["event: delta\ndata: {}"]);
    expect(rest).toBe('event: delta\ndata: {"tex');
  });

  it("一个完整帧都还没收齐时，frames 为空", () => {
    const { frames, rest } = splitSseFrames("event: del");
    expect(frames).toEqual([]);
    expect(rest).toBe("event: del");
  });

  it("刚好以空行结尾时 rest 为空", () => {
    const { frames, rest } = splitSseFrames("event: a\ndata: 1\n\n");
    expect(frames).toEqual(["event: a\ndata: 1"]);
    expect(rest).toBe("");
  });

  it("忽略纯空白的分段（心跳/多余空行）", () => {
    const { frames } = splitSseFrames("\n\nevent: a\ndata: 1\n\n");
    expect(frames).toEqual(["event: a\ndata: 1"]);
  });
});

describe("parseSseFrame", () => {
  it("取出 event 与 data", () => {
    expect(parseSseFrame('event: delta\ndata: {"text":"你"}')).toEqual({
      event: "delta",
      data: '{"text":"你"}',
    });
  });

  it("多行 data 按换行拼接", () => {
    expect(parseSseFrame("event: x\ndata: a\ndata: b").data).toBe("a\nb");
  });

  it("没有 event 字段时按规范当 message", () => {
    expect(parseSseFrame("data: hi").event).toBe("message");
  });
});
