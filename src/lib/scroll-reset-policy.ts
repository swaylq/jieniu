// 内容区滚动复位的判定（sway 直报 ②：「切资讯/公告 tab 后页面弹到最上方」）。
//
// 外壳固定后 window 自带的滚动复位对 `#main-content` 无效，所以有个 ScrollReset 组件在路由变化时
// 手动把内容区滚回顶部——「换页从头看」需要它，不能删。问题是它把**任何** query 变化一视同仁：
// tab 也是 query（`?tab=announce`），于是切 tab 也被当成换页，把人从列表深处甩回页首。
// 给 tab 的 `<Link>` 加 `scroll={false}` 修不掉——那只关掉 Next 自己的滚动，管不到这个组件。
//
// 判定就一条：**切 tab 不复位，其余照旧**。切 tab 时用户的注意力就在 tab 条上，页面不该动；
// 换页（`?page=`）、换实体页（pathname 变）、改搜索词都仍然复位。

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

/**
 * 该不该把内容区滚回顶部。`prev` 为 null 表示首次挂载——那时没有「上一个位置」，也无处可复位。
 * 注意 tab 切换常常同时丢掉 `page`（tab 链接本就回第 1 页），所以判据只看 tab 有没有变，
 * 不能看「差异参数集合是不是恰好等于 {tab}」。
 */
export function shouldResetScroll(prev: Loc | null, next: Loc): boolean {
  if (prev === null) return false;
  if (prev.pathname !== next.pathname) return true;
  if (tabOf(prev.search) !== tabOf(next.search)) return false; // 切 tab：留在原地
  return canonical(prev.search) !== canonical(next.search);
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
