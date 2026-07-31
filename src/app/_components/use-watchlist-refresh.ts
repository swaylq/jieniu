"use client";

import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

/**
 * 自选变更后刷新所有依赖它的视图（2026-07-31 sway 报「第一次登录选完持仓，左侧列表没自动刷新」）。
 *
 * 侧栏「持仓与观察」走 `api.watchlist.list.useQuery`——不 invalidate 就不会重查，
 * 于是写库成功、整页刷新后也在，唯独当场不动。而这套失效逻辑原本在每个调用点各抄一遍，
 * 抄了两处、漏了两处（onboarding 激活、自助加股）。收口成一个 hook，别再各写各的。
 *
 * @param refreshServer 是否连 server component 数据一起刷。**onboarding 必须传 false**：
 * `onboarding/page.tsx` 对 `watched.length > 0` 的用户 `redirect("/")`，
 * 刷新会把刚激活的用户从 step3 的回填演示里直接踢回首页。
 */
export function useWatchlistRefresh() {
  const router = useRouter();
  const utils = api.useUtils();

  return (refreshServer = true) => {
    void utils.watchlist.list.invalidate();
    void utils.watchlist.isFollowing.invalidate();
    void utils.portfolio.list.invalidate();
    void utils.feed.myFeed.invalidate();
    // 这里原本还失效 `entity.followerCount`——个股页的「N 人关注」已下线，没人订阅它了。
    if (refreshServer) router.refresh();
  };
}
