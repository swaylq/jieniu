// 归因事实核对的调用侧（2026-08-03）。相对导入、tsx 安全。
//
// 判据与提示词在 `lib/note-grounding`（纯函数、可测），这里只负责「一次调用核完一份复盘」
// 和**出错一律放行**。核查是加固，不是关卡：核查器挂了就该当它不存在，
// 绝不能因为它抽风把复盘弄空（密钥缺失型故障是静默的，见 lessons 7-24/7-25）。

import {
  GROUNDING_SYSTEM,
  buildGroundingPrompt,
  parseGroundingResponse,
  type GroundingItem,
  type GroundingVerdict,
} from "../lib/note-grounding";
import { llmChat } from "./llm";

/** 一次核完一批归因。任何异常 → 全部放行。 */
export async function checkNoteGrounding(
  items: GroundingItem[],
): Promise<GroundingVerdict[]> {
  const pass = () => items.map(() => ({ ok: true, why: "" }));
  if (items.length === 0) return [];
  try {
    const raw = await llmChat(GROUNDING_SYSTEM, buildGroundingPrompt(items), {
      maxTokens: 1200,
      // 核查要可复现：同一份输入每次都该给同一个结论
      temperature: 0,
    });
    return parseGroundingResponse(raw, items.length);
  } catch (e) {
    // **绝不裸 catch**——把原因打出来，否则这道核查会静默失效而没人知道
    console.error(
      "[grounding] 核查调用失败，本轮全部放行：",
      e instanceof Error ? e.message : e,
    );
    return pass();
  }
}

/** 一条待核归因在原对象上的位置——核完要按它把 note 清空。 */
export type NoteSlot = { item: GroundingItem; clear: () => void };

/**
 * 收集 → 核对 → 清空，并打一行可观测的账。
 * 降级/兜底必须能被看见，否则它会把上游 bug 伪装成「今天没料」（lessons 反复吃过的亏）。
 */
export async function groundNotes(slots: NoteSlot[], tag: string): Promise<number> {
  if (slots.length === 0) return 0;
  const verdicts = await checkNoteGrounding(slots.map((s) => s.item));
  let dropped = 0;
  slots.forEach((s, i) => {
    const v = verdicts[i];
    if (!v || v.ok) return;
    dropped++;
    console.log(`[grounding] ${tag} 判无据：${s.item.subject}｜${v.why}｜${s.item.note}`);
    s.clear();
  });
  console.log(`[grounding] ${tag} 核了 ${slots.length} 条归因，判无据 ${dropped} 条`);
  return dropped;
}
