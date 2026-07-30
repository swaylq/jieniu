/**
 * 单测取数组元素用。tsconfig 开了 `noUncheckedIndexedAccess`，`arr[0]` 的类型是
 * `T | undefined`，直接点属性会一路 TS18048 / TS2532；更隐蔽的是它会**挡住判别式窄化**
 * （`item.kind === "signal"` 在带 `| undefined` 的联合上 narrow 不动，报「属性不存在」）。
 *
 * 用 `nth()` 取值：缺元素时抛一句能读懂的失败信息，而不是让断言撞出个莫名其妙的类型错。
 * 负数下标从尾部数（`nth(tl, -1)` = 最后一个）。
 */
export function nth<T>(arr: readonly T[], i: number, what = "元素"): T {
  const v = i < 0 ? arr[arr.length + i] : arr[i];
  if (v === undefined) {
    throw new Error(`期望存在${what} [${i}]，实际数组长度 ${arr.length}`);
  }
  return v;
}
