/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  /**
   * 构建产物目录。默认 `.next`，但**可以用 `NEXT_DIST_DIR` 挪开**——这不是洁癖，是防事故：
   * 线上那台 `next start` 把 build manifest 载在内存里，任何人在同一个 `.next` 上再跑一次
   * `build`/`dev`，改动过的静态资源立刻 400，首页却仍然 200（我们已经踩过两次）。
   * 于是「本地开个 dev server 看一眼 UI」这种无害动作会打穿线上。
   * 现在验证 UI 一律：`NEXT_DIST_DIR=.next-dev next dev -p 3939`，与线上产物完全隔离。
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    /**
     * 客户端路由缓存存活时间（秒）。
     *
     * 全站页面都是 `force-dynamic`，而 Next 15 的 `dynamic` 默认是 **0** —— 等于每次换页都必须
     * 重新问服务端，连刚 prefetch 回来的载荷也不复用。解牛跑在 rathole 隧道后面，一次往返光
     * 网络就 ~150–250ms，这条默认值让「切页慢」直接翻倍。
     *
     * 设 30s：prefetch 拿回来的数据真的能用，来回切页 / 前进后退变成瞬时。数据新鲜度不受影响
     * ——所有写操作后面都跟着 `router.refresh()`（决策 / 持仓 / 我的逻辑 / 提醒复核都是这么写
     * 的），refresh 绕过这层缓存；30s 陈旧只发生在「纯浏览」路径上，对盯盘场景可接受。
     */
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default config;
