import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { fetchQuote, fetchIndexQuotes } from "~/server/quote";

export const quoteRouter = createTRPCRouter({
  get: publicProcedure
    .input(z.object({ ticker: z.string() }))
    .query(({ input }) => fetchQuote(input.ticker)),

  indices: publicProcedure.query(() => fetchIndexQuotes()),
});
