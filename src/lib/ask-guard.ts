// 流式作答的逐段合规护栏（2026-07-29）。
//
// 原来的合规是「拿到完整答案 → `isCompliant` 判废」，流式天然破坏这个前提：字已经在屏幕上了。
// 好在 `isCompliant` 是**纯正则扫描**、不依赖全文完整性，所以可以对**已生成的前缀**反复跑。
//
// 抽成这个小状态机是为了能单测——红线内容没法指使模型去说，只能在这里把
// 「分块到达、跨块拼出违规词、命中即掐断」这套行为钉死。route handler 用的就是它，
// 测的和跑的是同一份代码。

import { isCompliant, scanCompliance } from "./compliance";

export type GuardStep = {
  /** 到目前为止累积的文本。 */
  text: string;
  /** 是否已越线——一旦为 true 就该中止上游、丢弃这次回答。 */
  blocked: boolean;
  /** 命中的红线标签（便于日志与排查），未命中为 null。 */
  hit: string | null;
};

/**
 * 造一个逐块喂入的护栏。**一旦拦截就锁死**，后续再喂也保持拦截状态
 * （上游 abort 可能还有在途的块，不能让它把状态翻回去）。
 */
export function createStreamGuard() {
  let text = "";
  let blocked = false;
  let hit: string | null = null;

  return {
    push(delta: string): GuardStep {
      if (blocked) return { text, blocked, hit };
      text += delta;
      if (!isCompliant(text)) {
        blocked = true;
        hit = scanCompliance(text)[0]?.label ?? "未知";
      }
      return { text, blocked, hit };
    },
    /** 收尾整段再扫一次兜底。 */
    finish(): GuardStep {
      if (!blocked && !isCompliant(text)) {
        blocked = true;
        hit = scanCompliance(text)[0]?.label ?? "未知";
      }
      return { text, blocked, hit };
    },
  };
}
