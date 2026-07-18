"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";

import { api } from "~/trpc/react";

export function FollowButton({
  entityId,
  loggedIn,
  initialFollowing,
}: {
  entityId: string;
  loggedIn: boolean;
  initialFollowing: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const utils = api.useUtils();
  const [following, setFollowing] = useState(initialFollowing);

  // 关注状态变化后刷新所有依赖它的视图：侧栏「我的关注」、实体关注数、关注流。
  function refreshFollowViews() {
    void utils.watchlist.list.invalidate();
    void utils.watchlist.isFollowing.invalidate();
    void utils.entity.followerCount.invalidate();
    void utils.feed.myFeed.invalidate();
  }

  const track = api.analytics.track.useMutation();
  const follow = api.watchlist.follow.useMutation({
    onSuccess: () => {
      setFollowing(true);
      track.mutate({ type: "follow", entityId });
      refreshFollowViews();
    },
  });
  const unfollow = api.watchlist.unfollow.useMutation({
    onSuccess: () => {
      setFollowing(false);
      refreshFollowViews();
    },
  });
  const pending = follow.isPending || unfollow.isPending;

  if (!loggedIn) {
    return (
      <button
        type="button"
        onClick={() =>
          router.push(`/login?returnTo=${encodeURIComponent(pathname)}`)
        }
        className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-brand hover:text-brand"
      >
        登录后关注
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        following ? unfollow.mutate({ entityId }) : follow.mutate({ entityId })
      }
      disabled={pending}
      className={
        following
          ? "shrink-0 rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition-colors disabled:opacity-50"
          : "shrink-0 rounded-full bg-brand px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
      }
    >
      {following ? "已关注 ✓" : "+ 关注"}
    </button>
  );
}
