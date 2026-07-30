/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
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
