// 「问解牛」的流式作答（2026-07-29，sway 直报：需要 SSE + 打字机）。
//
// 为什么是 route handler 而不是 tRPC：tRPC 的 mutation 拿不到增量，而 `EventSource` 又不能 POST，
// 所以走 POST + `text/event-stream`，客户端用 fetch + ReadableStream 读。
//
// **合规怎么办**（这是最关键的一处设计，sway 选的方案 B）：
// 原来的做法是「拿到完整答案 → `isCompliant` 判废 → 才返回」，流式天然破坏这个前提。
// 好在 `isCompliant` 是**纯正则扫描**、不依赖全文完整性，所以可以对**已生成的前缀**反复跑：
// 每收到一块就扫一次，命中就立刻 abort 上游、吐 `blocked` 事件、并且**不落库**
// （沿用「判废不入库」的既有惯例）。收尾再整段扫一次兜底。
// 于是暴露窗口被压到一块增量以内，而不是整段答案。

import { NextResponse } from "next/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { buildAskContext } from "~/lib/ask-context";
import { loadAskMemory } from "~/server/ask-memory";
import { loadAskFacts } from "~/server/ask-facts";
import {
  renderAskFacts,
  factCount,
  invalidCitations,
  ungroundedNumbers,
} from "~/lib/ask-facts";
import { askConversationPrompt } from "~/lib/ask-prompt";
import { recentTurns, type AskTurn } from "~/lib/ask-history";
import { ASK_SYSTEM } from "~/server/ai";
import { llmChatStream } from "~/server/llm-stream";
import { createStreamGuard } from "~/lib/ask-guard";
import { withDisclaimer, DISCLAIMER } from "~/lib/compliance";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BLOCKED_TEXT =
  "抱歉，这个回答在合规检查中被拦截了，暂不展示。可以换个问法，或直接查看相关资讯原文。";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = (await req.json().catch(() => null)) as {
    question?: unknown;
    newsId?: unknown;
    entityId?: unknown;
  } | null;
  const question =
    typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 500) {
    return NextResponse.json({ error: "问题为空或过长" }, { status: 400 });
  }
  // 「问解牛这条」带过来的那条资讯 / 当前个股页——答案通常就在这条的正文里
  // （Alley_Stella 2026-08-04：点的就是那条业绩预告，摘要里写着「汇兑损失增加」）。
  const newsId = typeof body?.newsId === "string" ? body.newsId : null;
  const entityId = typeof body?.entityId === "string" ? body.entityId : null;

  const [memory, historyRows, factsRes] = await Promise.all([
    loadAskMemory(db, userId),
    db.askMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    }),
    loadAskFacts(db, { question, newsId, entityId }),
  ]);
  const built = buildAskContext(memory);
  const history = recentTurns(
    historyRows.map((r) => ({ role: r.role, content: r.content }) as AskTurn),
  );
  const factsText = renderAskFacts(factsRes);
  const nFacts = factCount(factsRes);
  console.log(
    `[ask/stream] 主体 ${factsRes.subjects.join("/") || "（未识别）"}｜可引用事实 ${nFacts} 条`,
  );

  const prompt = askConversationPrompt({
    question,
    context: built.contextText,
    hasMemory: built.hasMemory,
    history,
    facts: factsText,
    subjects: factsRes.subjects,
    guessed: factsRes.guessed,
    ambiguous: factsRes.ambiguous,
  });

  // 用户那条先落库：即使 AI 挂了，用户也不该丢掉自己刚打的字。
  await db.askMessage.create({
    data: { userId, role: "user", content: question },
  });

  const controller = new AbortController();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (event: string, data: unknown) =>
        ctrl.enqueue(encoder.encode(sse(event, data)));
      // 逐段护栏的状态机抽在 `lib/ask-guard`，那边有单测钉住「红线被拆在两块之间也要抓到」
      // 这类行为——红线内容没法指使模型去说，只能靠单测保证，所以跑的和测的必须是同一份代码。
      const guard = createStreamGuard();
      let blocked = false;
      try {
        for await (const delta of llmChatStream(ASK_SYSTEM, prompt, {
          signal: controller.signal,
        })) {
          const step = guard.push(delta);
          if (step.blocked) {
            blocked = true;
            console.warn(`[ask/stream] 合规拦截：${step.hit}`);
            controller.abort(); // 别再烧 token
            break;
          }
          send("delta", { text: delta });
        }
      } catch (e) {
        // 绝不裸 catch——密钥缺失 / 上游 5xx 都要留下原因（7-24 那次就是被吞了）。
        if (!blocked) {
          console.error(
            "[ask/stream] 流式作答失败:",
            e instanceof Error ? e.message : e,
          );
          send("error", { message: "解牛暂时无法作答，请稍后再试。" });
          ctrl.close();
          return;
        }
      }

      // 收尾整段再扫一次兜底。
      const final = guard.finish();
      if (blocked || final.blocked) {
        send("blocked", { text: BLOCKED_TEXT });
        ctrl.close();
        return; // 判废不入库
      }

      // 收尾核查（B3）：出处编号必须真的存在，带单位的数字必须来自语料。
      // 两条都是**机械判据**、零成本、不阻塞流——文字已经打出去了，退不回来，
      // 所以判否时**追加一行诚实的提示**并留日志，而不是假装无事发生。
      const corpus = `${factsText}\n${built.contextText}`;
      const badCite = invalidCitations(final.text, nFacts);
      const badNum = ungroundedNumbers(final.text, corpus);
      let caveat = "";
      if (badCite.length > 0 || badNum.length > 0) {
        const bits = [
          badCite.length > 0 ? `出处 ${badCite.map((n) => `[${n}]`).join("")} 不存在` : "",
          badNum.length > 0 ? `数字 ${badNum.join("、")} 未出现在解牛收录的原文里` : "",
        ].filter(Boolean);
        console.warn(`[ask/stream] 核查未过：${bits.join("；")}`);
        caveat = `\n\n> ⚠️ 这段回答里有内容我没能在解牛收录的原文里核对上（${bits.join("；")}），请以原文为准。`;
      }

      const answer = withDisclaimer(final.text + caveat);
      await db.askMessage.create({
        data: { userId, role: "assistant", content: answer },
      });
      if (caveat) send("delta", { text: caveat });
      // 免责声明不走流（它是固定尾巴，逐字打出来没有意义），最后一次性补上。
      send("done", { disclaimer: `\n\n—— ${DISCLAIMER}` });
      ctrl.close();
    },
    cancel() {
      // 用户关掉面板 / 切走页面：别让上游继续烧 token。
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 隧道后面有 Caddy，明确关掉缓冲，否则流会被攒成一整块再发（就白做流式了）。
      "X-Accel-Buffering": "no",
    },
  });
}
