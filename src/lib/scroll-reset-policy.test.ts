import { describe, it, expect } from "vitest";
import {
  shouldResetScroll,
  clampScrollTarget,
  type Loc,
} from "./scroll-reset-policy";

const loc = (pathname: string, search = ""): Loc => ({ pathname, search });

describe("shouldResetScroll — 换页从头看，切 tab 别把人甩回页首（sway 直报 ②）", () => {
  it("切 tab 不复位", () => {
    expect(
      shouldResetScroll(loc("/entity/x", "tab=news"), loc("/entity/x", "tab=announce")),
    ).toBe(false);
  });

  it("切 tab 顺带丢掉 page 参数时也不复位（tab 链接本来就回第 1 页）", () => {
    expect(
      shouldResetScroll(
        loc("/entity/x", "tab=news&page=3"),
        loc("/entity/x", "tab=announce"),
      ),
    ).toBe(false);
  });

  it("从「没有 tab 参数」点到某个 tab，同样算切 tab", () => {
    expect(shouldResetScroll(loc("/entity/x"), loc("/entity/x", "tab=announce"))).toBe(
      false,
    );
  });

  it("换页仍然复位（这正是它当初被加进来的原因）", () => {
    expect(
      shouldResetScroll(
        loc("/entity/x", "tab=news&page=2"),
        loc("/entity/x", "tab=news&page=3"),
      ),
    ).toBe(true);
  });

  it("换到另一个实体页要复位，即使 tab 一样", () => {
    expect(
      shouldResetScroll(loc("/entity/x", "tab=news"), loc("/entity/y", "tab=news")),
    ).toBe(true);
  });

  it("首次挂载不复位（没有「上一个位置」可言）", () => {
    expect(shouldResetScroll(null, loc("/entity/x", "tab=announce"))).toBe(false);
  });

  it("位置没变就不折腾", () => {
    expect(
      shouldResetScroll(loc("/entity/x", "tab=news"), loc("/entity/x", "tab=news")),
    ).toBe(false);
  });

  it("其它 query 变化（搜索词等）保持原来的复位行为", () => {
    expect(shouldResetScroll(loc("/discover", "q=a"), loc("/discover", "q=b"))).toBe(
      true,
    );
  });

  it("参数顺序不同但内容相同的 tab，不算切换", () => {
    expect(
      shouldResetScroll(
        loc("/entity/x", "page=2&tab=news"),
        loc("/entity/x", "tab=news&page=2"),
      ),
    ).toBe(false);
  });
});

describe("clampScrollTarget — 新 tab 更短时把还原位置贴到底，不能超出", () => {
  it("新内容够高就原样还原", () => {
    expect(clampScrollTarget(900, 8968, 900)).toBe(900);
  });
  it("新内容更短就还原到能滚的最大处", () => {
    expect(clampScrollTarget(4000, 5295, 900)).toBe(4000);
    expect(clampScrollTarget(4000, 3000, 900)).toBe(2100);
  });
  it("新内容不足一屏就回到 0，不出负数", () => {
    expect(clampScrollTarget(900, 600, 900)).toBe(0);
  });
});
