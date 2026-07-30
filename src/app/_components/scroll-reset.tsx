"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  shouldResetScroll,
  clampScrollTarget,
  type Loc,
} from "~/lib/scroll-reset-policy";

/**
 * 还原窗口。原来给到 1500ms，但新 tab 比原来短时 `target` 永远够不到 `saved`，
 * 于是整整 1.5 秒每帧都读一次 `scrollHeight`、写一次 `scrollTop`（强制回流），
 * 白白压着主线程。600ms 足够覆盖内容落地，加上「高度稳定两帧就收手」，
 * 正常情况下几帧就结束了。
 */
const RESTORE_WINDOW_MS = 600;
/** 连续这么多帧高度不再变化，就认为内容已经落地，不必再试。 */
const STABLE_FRAMES = 2;

/**
 * 外壳固定后滚动发生在 #main-content 而非 window，Next 路由切换自带的滚动复位对它无效
 * （换页会停在上一页的滚动位置）。这里在路由变化后把内容区滚回顶部，保留「换页从头看」的常规语义。
 *
 * 唯一的例外是**切 tab**（sway 直报 ②）。这条路走了两步才修对：
 *  1. 先按 `shouldResetScroll` 不再主动复位——但实测仍然弹回顶部；
 *  2. 用 CDP 逐帧采样才看清真因：切 tab 会把滚动容器的子树整棵换掉，那一瞬内容高度塌下去，
 *     **浏览器自己**把 scrollTop 夹成 0（同一个 DOM 节点、全程没有任何 scrollTo/scrollTop 调用）。
 * 所以「不主动滚」不够，还得在新内容落地后把位置还回去——就是下面这段。
 *
 * 位置在 pointerdown / keydown 时快照（那会儿旧内容还在，scrollTop 还是真的）；
 * 还原过程中用户一动（滚轮 / 触摸 / 按键）就立刻放弃，不跟人抢。
 */
export function ScrollReset() {
  const pathname = usePathname();
  // 用字符串而非 ReadonlyURLSearchParams 对象做依赖：后者每次渲染都是新引用。
  const search = useSearchParams().toString();
  const prev = useRef<Loc | null>(null);
  const snapshot = useRef(0);

  // 导航发生前抓一次位置：等 effect 跑的时候，浏览器早把 scrollTop 夹成 0 了，来不及。
  useEffect(() => {
    const take = () => {
      const el = document.getElementById("main-content");
      if (el) snapshot.current = el.scrollTop;
    };
    document.addEventListener("pointerdown", take, true);
    document.addEventListener("keydown", take, true);
    return () => {
      document.removeEventListener("pointerdown", take, true);
      document.removeEventListener("keydown", take, true);
    };
  }, []);

  useEffect(() => {
    const next: Loc = { pathname, search };
    const el = document.getElementById("main-content");
    const wasReset = shouldResetScroll(prev.current, next);
    prev.current = next;
    if (!el) return;

    if (wasReset) {
      el.scrollTo({ top: 0 });
      return;
    }
    const saved = snapshot.current;
    if (saved <= 0) return;

    // 新内容是异步落地的（force-dynamic + loading 边界），所以在一小段时间内反复尝试还原，
    // 直到高度够了为止；用户自己一动就收手。
    let raf = 0;
    let done = false;
    const deadline = performance.now() + RESTORE_WINDOW_MS;
    const stop = () => {
      done = true;
      cancelAnimationFrame(raf);
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
    el.addEventListener("wheel", stop, { passive: true, once: true });
    el.addEventListener("touchstart", stop, { passive: true, once: true });
    window.addEventListener("keydown", stop, { once: true });

    let lastHeight = -1;
    let stable = 0;
    const tick = () => {
      if (done) return;
      const height = el.scrollHeight;
      const target = clampScrollTarget(saved, height, el.clientHeight);
      if (target > 0) el.scrollTop = target;
      stable = height === lastHeight ? stable + 1 : 0;
      lastHeight = height;
      // 收手条件：够到目标 / 高度已稳定（新内容落地了，再试也没用）/ 时间用完。
      if (
        target >= saved ||
        stable >= STABLE_FRAMES ||
        performance.now() > deadline
      ) {
        stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return stop;
  }, [pathname, search]);

  return null;
}
