"use client";

import { useState } from "react";
import Link from "next/link";

type Props = Omit<React.ComponentProps<typeof Link>, "prefetch">;

/**
 * 悬停/聚焦才预取的 `<Link>` —— 给「又重又多」的链接用（侧栏持仓里的个股页）。
 *
 * 为什么不能像主导航那样直接 `prefetch`：个股页是全站最重的一页（RSC 载荷 ~100KB），侧栏可能挂
 * 着几十只自选，一进页面就全量预取等于替用户把整个组合拉一遍。也不能就这么放着——实测公网点
 * 侧栏个股到主内容上屏要 ~500ms，绝大部分是隧道往返 + 载荷传输。
 *
 * 折中：鼠标移上去（或键盘聚焦）才把 `prefetch` 打开。人从悬停到点击通常有 200–400ms，正好把那
 * 次往返藏进去；没兴趣的链接一个字节都不拉。`onTouchStart` 是移动端的聊胜于无版本（没有 hover，
 * 但按下到抬起也有几十毫秒）。
 *
 * `prefetch` 变 true 时 Next 才会真的去取完整载荷——所以这里靠 state 翻转触发，而不是调
 * `router.prefetch()`（App Router 那个对动态路由只预热到 loading 边界，不给完整载荷）。
 *
 * **悬停前必须是 `undefined`（Next 默认），不能是 `false`。** `false` 会把默认那层也关掉——
 * 连路由 JS chunk 和 loading 边界都不预热，于是「没悬停直接点」（键盘 / 触屏 / 鼠标直接落点）
 * 反而比原来的普通 `<Link>` 更慢。实测踩过：新闻卡从首页直接点一度到 953ms。
 * 现在是两档：默认档（便宜，chunk + loading 边界）→ 悬停后升到完整载荷。
 */
export function HoverPrefetchLink({
  children,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...rest
}: Props) {
  const [warm, setWarm] = useState(false);

  return (
    <Link
      {...rest}
      prefetch={warm ? true : undefined}
      onMouseEnter={(e) => {
        setWarm(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        setWarm(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setWarm(true);
        onTouchStart?.(e);
      }}
    >
      {children}
    </Link>
  );
}
