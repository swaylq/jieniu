import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import {
  generateNeutralInterpretation,
  generatePersonaInterpretation,
  personaName,
} from "~/server/ai";
import { isCompliant, withDisclaimer } from "~/lib/compliance";
import { rateLimit } from "~/lib/rate-limit";

type LensSig = {
  dimensionKey: string;
  direction: string;
  materiality: number;
  note: string;
};

export const interpretRouter = createTRPCRouter({
  /** thesis 感知解读（Phase 3 P3-8）：这条资讯预先算好的信号，按实体分组——"动没动你的逻辑"。复用 P3-3 结果，不新调 AI。 */
  thesisLens: publicProcedure
    .input(z.object({ newsId: z.string() }))
    .query(async ({ ctx, input }) => {
      const signals = await ctx.db.thesisSignal.findMany({
        where: { newsId: input.newsId },
        orderBy: { materiality: "desc" },
        select: {
          entityId: true,
          dimensionKey: true,
          direction: true,
          materiality: true,
          note: true,
        },
      });
      if (signals.length === 0)
        return [] as {
          entityId: string;
          entityName: string;
          signals: LensSig[];
        }[];

      const entIds = [...new Set(signals.map((s) => s.entityId))];
      const ents = await ctx.db.entity.findMany({
        where: { id: { in: entIds } },
        select: { id: true, name: true },
      });
      const nameById = new Map(ents.map((e) => [e.id, e.name]));

      const byEntity = new Map<
        string,
        { entityId: string; entityName: string; signals: LensSig[] }
      >();
      for (const s of signals) {
        const g =
          byEntity.get(s.entityId) ??
          {
            entityId: s.entityId,
            entityName: nameById.get(s.entityId) ?? "",
            signals: [] as LensSig[],
          };
        g.signals.push({
          dimensionKey: s.dimensionKey,
          direction: s.direction,
          materiality: s.materiality,
          note: s.note,
        });
        byEntity.set(s.entityId, g);
      }
      return [...byEntity.values()];
    }),

  /** 取（缓存）或生成一条中性 AI 解读。生成后过合规过滤 + 附免责声明再入库。 */
  getOrCreate: publicProcedure
    .input(
      z.object({
        newsId: z.string(),
        kind: z
          .enum(["NEUTRAL", "BUFFETT", "MUNGER", "LYNCH", "GRAHAM"])
          .default("NEUTRAL"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.interpretation.findUnique({
        where: { newsId_kind: { newsId: input.newsId, kind: input.kind } },
      });
      if (existing) return { content: existing.content, cached: true };

      // 生成路径（未命中缓存才走）：需登录 + 限流。
      // 缓存命中对匿名开放（解读按 newsId+kind 全局共享），但付费生成只放给登录用户，
      // 防匿名者刷任意 (newsId,kind) 触发付费 AI 生成（成本 DoS）。
      if (!ctx.session?.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "登录后可生成 AI 解读。",
        });
      }
      if (!rateLimit(`interp:${ctx.session.user.id}`, 20, 60_000)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "生成过于频繁，请稍后再试。",
        });
      }

      const news = await ctx.db.newsItem.findUnique({
        where: { id: input.newsId },
        select: {
          title: true,
          summary: true,
          content: true,
          source: { select: { name: true } },
        },
      });
      if (!news) throw new TRPCError({ code: "NOT_FOUND" });

      const newsInput = {
        title: news.title,
        summary: news.summary,
        content: news.content,
        sourceName: news.source.name,
      };
      const raw =
        input.kind === "NEUTRAL"
          ? await generateNeutralInterpretation(newsInput)
          : await generatePersonaInterpretation(input.kind, newsInput);
      const safe = isCompliant(raw)
        ? raw
        : "该资讯的 AI 解读在合规检查中被拦截，暂不展示；请点击原文了解一手信息。";
      const body =
        input.kind === "NEUTRAL"
          ? safe
          : `【以下为「${personaName(input.kind)}」投资思维方式演示，非投资建议】\n\n${safe}`;
      const content = withDisclaimer(body);

      try {
        await ctx.db.interpretation.create({
          data: {
            newsId: input.newsId,
            kind: input.kind,
            content,
            model: env.OPENROUTER_MODEL,
          },
        });
      } catch (e) {
        // 并发未命中：另一个请求已抢先写入同一 (newsId,kind) → 回读缓存，
        // 避免唯一键冲突抛 500（两个请求各自已付费生成一次，属可接受的偶发重复）。
        if (
          e &&
          typeof e === "object" &&
          "code" in e &&
          (e as { code?: string }).code === "P2002"
        ) {
          const won = await ctx.db.interpretation.findUnique({
            where: { newsId_kind: { newsId: input.newsId, kind: input.kind } },
          });
          if (won) return { content: won.content, cached: true };
        }
        throw e;
      }
      return { content, cached: false };
    }),
});
