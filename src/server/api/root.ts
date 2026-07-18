import { accountRouter } from "~/server/api/routers/account";
import { analyticsRouter } from "~/server/api/routers/analytics";
import { askRouter } from "~/server/api/routers/ask";
import { authRouter } from "~/server/api/routers/auth";
import { billingRouter } from "~/server/api/routers/billing";
import { bookmarksRouter } from "~/server/api/routers/bookmarks";
import { decisionRouter } from "~/server/api/routers/decision";
import { entityRouter } from "~/server/api/routers/entity";
import { feedRouter } from "~/server/api/routers/feed";
import { interpretRouter } from "~/server/api/routers/interpret";
import { investorProfileRouter } from "~/server/api/routers/investor-profile";
import { newsRouter } from "~/server/api/routers/news";
import { notificationsRouter } from "~/server/api/routers/notifications";
import { portfolioRouter } from "~/server/api/routers/portfolio";
import { postRouter } from "~/server/api/routers/post";
import { priceAlertRouter } from "~/server/api/routers/priceAlert";
import { quoteRouter } from "~/server/api/routers/quote";
import { userThesisRouter } from "~/server/api/routers/user-thesis";
import { watchlistRouter } from "~/server/api/routers/watchlist";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  account: accountRouter,
  analytics: analyticsRouter,
  ask: askRouter,
  auth: authRouter,
  billing: billingRouter,
  bookmarks: bookmarksRouter,
  decision: decisionRouter,
  entity: entityRouter,
  feed: feedRouter,
  interpret: interpretRouter,
  investorProfile: investorProfileRouter,
  news: newsRouter,
  notifications: notificationsRouter,
  portfolio: portfolioRouter,
  post: postRouter,
  priceAlert: priceAlertRouter,
  quote: quoteRouter,
  userThesis: userThesisRouter,
  watchlist: watchlistRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
