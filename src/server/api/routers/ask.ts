import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { buildAskContext } from "~/lib/ask-context";
import { loadAskMemory } from "~/server/ask-memory";
import { loadAskFacts } from "~/server/ask-facts";
import {
  renderAskFacts,
  factCount,
  invalidCitations,
  ungroundedNumbers,
} from "~/lib/ask-facts";
import { answerUserQuestion } from "~/server/ai";
import { isCompliant, withDisclaimer } from "~/lib/compliance";
import { rateLimit } from "~/lib/rate-limit";

/**
 * 「问解牛」（P5-5）——全局、结合用户四层 Memory 的私人投研问答。
 * AI 只在用户**显式提问**时调用（省 token 合规）；答案过合规过滤 + 附免责声明。
 * 回答下方的「记为投资笔记」写回 Decision（action=NOTE），让问答能沉淀进系统记忆。
 */
export const askRouter = createTRPCRouter({
  /**
   * 持续对话的历史（2026-07-29）。一位用户一条连续线，按时间正序全量返回——
   * 面板打开时拉一次；**进提示词的只有最近几条**（见 lib/ask-history），两者不是一回事。
   */
  history: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.askMessage.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      role: r.role === "user" ? ("user" as const) : ("assistant" as const),
      content: r.content,
      createdAt: r.createdAt,
    }));
  }),

  /** 清空对话（用户自己的数据，自己说了算）。 */
  clearHistory: protectedProcedure.mutation(async ({ ctx }) => {
    const { count } = await ctx.db.askMessage.deleteMany({
      where: { userId: ctx.session.user.id },
    });
    return { cleared: count };
  }),

  answer: protectedProcedure
    .input(
      z.object({
        question: z.string().min(1).max(500),
        newsId: z.string().optional(),
        entityId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const q = input.question.trim();
      if (q.length === 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "问题不能为空" });

      const uid = ctx.session.user.id;

      // 付费 AI 生成：per-user 限流（与 interpret.getOrCreate 同款闸）。
      // 流式那条路（/api/ask/stream）在 route handler 里是另一份，别漏。
      if (!rateLimit(`ask:answer:${uid}`, 20, 60_000)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "提问过于频繁，请稍后再试。",
        });
      }
      // 记忆取数抽到 `server/ask-memory`（流式那条路也用同一份，别写两遍）。
      // 事实层同理走 `server/ask-facts`——两条路给出的口径必须一致。
      const [mem, factsRes] = await Promise.all([
        loadAskMemory(ctx.db, uid),
        loadAskFacts(ctx.db, {
          question: q,
          newsId: input.newsId ?? null,
          entityId: input.entityId ?? null,
        }),
      ]);

      const built = buildAskContext(mem);
      const factsText = renderAskFacts(factsRes);

      let raw: string;
      try {
        raw = await answerUserQuestion({
          question: q,
          context: built.contextText,
          hasMemory: built.hasMemory,
          facts: factsText,
          subjects: factsRes.subjects,
          guessed: factsRes.guessed,
          ambiguous: factsRes.ambiguous,
        });
      } catch (e) {
        // 一定要打日志：以前这里是裸 `catch {}`，AI 层挂了整整一天，
        // 日志里只有一行「ask.answer took 30ms」，查不出任何原因。
        console.error(
          "[ask] AI 作答失败:",
          e instanceof Error ? e.message : e,
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "解牛暂时无法作答，请稍后再试。",
        });
      }

      const safe = isCompliant(raw)
        ? raw
        : "抱歉，这个回答在合规检查中被拦截了，暂不展示。可以换个问法，或直接查看相关资讯原文。";

      // 与流式那条路同一套收尾核查：出处编号要存在、带单位的数字要来自语料。
      const badCite = invalidCitations(safe, factCount(factsRes));
      const badNum = ungroundedNumbers(safe, `${factsText}\n${built.contextText}`);
      if (badCite.length > 0 || badNum.length > 0) {
        console.warn(
          `[ask] 核查未过：出处 ${badCite.join("/") || "-"}｜数字 ${badNum.join("/") || "-"}`,
        );
      }

      return {
        answer: withDisclaimer(safe),
        grounding: {
          holdings: built.groundedHoldings,
          theses: built.groundedTheses,
          hasMemory: built.hasMemory,
          subjects: factsRes.subjects,
          facts: factCount(factsRes),
          unverified: badCite.length > 0 || badNum.length > 0,
        },
      };
    }),

  /** 写回：把这条问答的要点记为某持仓的投资笔记（Decision action=NOTE，仅观察、非交易）。 */
  saveNote: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        note: z.string().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.db.decision.create({
        data: {
          userId: ctx.session.user.id,
          entityId: input.entityId,
          action: "NOTE",
          reason: input.note.trim(),
        },
        select: { id: true },
      });
      return { ok: true, id: created.id };
    }),
});
