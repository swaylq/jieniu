// 「问解牛」持续对话的历史裁剪（2026-07-29，sway 直报）。
//
// 每一轮都要把四层记忆（持仓 / thesis / 信号 / 决策）喂进提示词，再叠上聊天历史，
// token 会滚雪球。所以历史**存全量、只带最近几条**进上下文。

export type AskTurn = { role: "user" | "assistant"; content: string };

/** 进提示词的历史条数上限（约 3 问 3 答）。存库不受此限。 */
export const ASK_HISTORY_TURNS = 6;

/**
 * 取最近 N 条。**截断后不以 assistant 开头**——半截的答话当上文会让模型以为
 * 自己刚说过什么、接着往下编；宁可少带一条也要从用户的问题开始。
 * 输入须按时间正序。
 */
export function recentTurns(
  rows: AskTurn[],
  limit = ASK_HISTORY_TURNS,
): AskTurn[] {
  const tail = rows.slice(-limit);
  return tail[0]?.role === "assistant" ? tail.slice(1) : tail;
}

/** 拼成提示词里的一段对话记录；没有历史就返回空串，调用方据此整段省略。 */
export function transcript(rows: AskTurn[]): string {
  if (rows.length === 0) return "";
  return rows
    .map((r) => `${r.role === "user" ? "用户" : "解牛"}：${r.content}`)
    .join("\n");
}
