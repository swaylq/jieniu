// 客户端读 `text/event-stream` 的最小解析（2026-07-29，问解牛流式作答用）。
//
// 为什么不用 `EventSource`：它只能 GET，而提问要 POST（问题可能很长、也不该进 URL）。
// 所以走 `fetch` + `ReadableStream`，帧解析自己做——就下面这两个纯函数，好测。

export type SseFrame = { event: string; data: string };

/**
 * 从累积缓冲里切出**完整**的帧（以空行分隔）；最后一段可能只收到一半，原样留给下一轮。
 * 这是流式解析最容易出错的地方：把半截帧当完整帧解，就会丢字或抛异常。
 */
export function splitSseFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts.filter((p) => p.trim() !== ""), rest };
}

/** 解析一帧：取 `event:` 与（可多行的）`data:`。没有 event 字段时按 SSE 规范当 "message"。 */
export function parseSseFrame(frame: string): SseFrame {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  return { event, data: data.join("\n") };
}
