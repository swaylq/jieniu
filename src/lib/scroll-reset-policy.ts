// 内容区滚动复位的判定（sway 直报 ②：「切资讯/公告 tab 后页面弹到最上方」）。
//
// 外壳固定后 window 自带的滚动复位对 `#main-content` 无效，所以有个 ScrollReset 组件在路由变化时
// 手动把内容区滚回顶部——「换页从头看」需要它，不能删。问题是它把**任何** query 变化一视同仁：
// tab 也是 query（`?tab=announce`），于是切 tab 也被当成换页，把人从列表深处甩回页首。
// 给 tab 的 `<Link>` 加 `scroll={false}` 修不掉——那只关掉 Next 自己的滚动，管不到这个组件。
//
// 判定分三档（2026-07-31 sway 又报「翻页的时候页面又会滚到最上面」后细化）：
//   切 tab → 留在原地；翻页 / 切「本公司·全部」 → 滚到 tab 条（列表顶部，配合 sticky 的 tab 条正好衔接）；
//   换实体页 / 改搜索词 → 回整页顶部。
// 翻页原来也回整页顶部，意味着翻一页就得重新往下滚一大段，这正是 sway 报的那件事。

export type Loc = { pathname: string; search: string };

function tabOf(search: string): string {
  return new URLSearchParams(search).get("tab") ?? "";
}

/** 参数顺序不该影响判定——按键排序后再比，免得「同一个位置」被当成变化。 */
function canonical(search: string): string {
  const p = new URLSearchParams(search);
  p.sort();
  return p.toString();
}

function pageOf(search: string): string {
  return new URLSearchParams(search).get("page") ?? "";
}

/** 「资讯」tab 里的「本公司 / 全部」开关（2026-08-18）：与翻页同类——换的是同一个列表的内容。 */
function scopeOf(search: string): string {
  return new URLSearchParams(search).get("scope") ?? "";
}

/**
 * 路由变化后内容区该怎么动：
 * - `none` —— 留在原地（切 tab；首次挂载也归此类，没有「上一个位置」可言）
 * - `tabs` —— 滚到 tab 条（翻页：回到列表顶部，而不是整页顶部）
 * - `top`  —— 回整页顶部（换实体页、改搜索词等）
 *
 * 判据顺序有讲究：**先判 tab**。tab 链接本就回第 1 页、会顺带丢掉 `page`，
 * 若先判 page 就会把「切 tab」误判成「翻页」。
 */
export type ScrollAction = "none" | "tabs" | "top";

export function scrollAction(prev: Loc | null, next: Loc): ScrollAction {
  if (prev === null) return "none";
  if (prev.pathname !== next.pathname) return "top";
  if (tabOf(prev.search) !== tabOf(next.search)) return "none"; // 切 tab：留在原地
  if (pageOf(prev.search) !== pageOf(next.search)) return "tabs"; // 翻页：回列表顶部
  // 切「本公司 / 全部」同理：换的是同一个列表的内容，回列表顶部而不是整页顶部
  // （开关就画在 tab 条下面，弹回页首等于把人从刚点的那个控件旁边甩走）。
  if (scopeOf(prev.search) !== scopeOf(next.search)) return "tabs";
  return canonical(prev.search) !== canonical(next.search) ? "top" : "none";
}

/**
 * 「留在原地」还不够——切 tab 会把滚动容器的子树整棵换掉，那一瞬间内容高度塌到 0，
 * **浏览器自己**就把 scrollTop 夹成 0 了（实测：同一个 DOM 节点、没有任何 scrollTo/scrollTop 调用，
 * 一帧之内 900 → 0）。所以还得在新内容落地后把位置还回去。
 * 这里算还原目标：不能超过新内容能滚的最大值（新 tab 更短时就贴到底）。
 */
export function clampScrollTarget(
  saved: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, Math.min(saved, scrollHeight - clientHeight));
}
