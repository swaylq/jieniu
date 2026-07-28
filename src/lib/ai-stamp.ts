/**
 * AI 产出的生成时间戳。
 *
 * 借鉴富途「牛牛财报站」的一个小动作：AI 财报看点旁边直接标「更新时间：07/27 19:59」。
 * 一个时间戳就把「这是活的、还在跟」立住了——AI 结论最怕的不是错，是让人分不清
 * 它是刚算的还是三个月前的缓存。解牛的解读是按 (newsId,kind) 永久缓存的，
 * 没有时间戳就完全看不出新旧。
 */

/** 同年 `MM/DD HH:mm`；跨年补上 `YYYY/`。非法输入返回空串，让调用方直接不渲染。 */
export function formatGeneratedAt(
  at: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (at === null || at === undefined) return "";
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";

  const p2 = (n: number) => String(n).padStart(2, "0");
  const md = `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}/${md}`;
}
