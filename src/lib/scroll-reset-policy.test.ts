import { describe, it, expect } from "vitest";
import {
  scrollAction,
  clampScrollTarget,
  type Loc,
} from "./scroll-reset-policy";

const loc = (pathname: string, search = ""): Loc => ({ pathname, search });

describe("shouldResetScroll — 换页从头看，切 tab 别把人甩回页首（sway 直报 ②）", () => {
  it("切 tab 不复位", () => {
    expect(
      scrollAction(loc("/entity/x", "tab=news"), loc("/entity/x", "tab=announce")),
    ).toBe("none");
  });

  it("切 tab 顺带丢掉 page 参数时也不复位（tab 链接本来就回第 1 页）", () => {
    expect(
      scrollAction(
        loc("/entity/x", "tab=news&page=3"),
        loc("/entity/x", "tab=announce"),
      ),
    ).toBe("none");
  });

  it("从「没有 tab 参数」点到某个 tab，同样算切 tab", () => {
    expect(scrollAction(loc("/entity/x"), loc("/entity/x", "tab=announce"))).toBe(
      "none",
    );
  });

  // sway 2026-07-31：「翻页的时候页面又会滚到最上面」——翻页该回到**列表顶部**（tab 条那儿），
  // 不是整页顶部；否则翻一页就要重新往下滚一大段。
  it("换页滚到 tab 条，而不是整页顶部", () => {
    expect(
      scrollAction(
        loc("/entity/x", "tab=news&page=2"),
        loc("/entity/x", "tab=news&page=3"),
      ),
    ).toBe("tabs");
  });

  it("从第 1 页翻到第 2 页（原来没有 page 参数）同样滚到 tab 条", () => {
    expect(
      scrollAction(loc("/entity/x", "tab=news"), loc("/entity/x", "tab=news&page=2")),
    ).toBe("tabs");
  });

  it("切 tab 顺带丢掉 page 时按切 tab 处理（留在原地），不当成翻页", () => {
    expect(
      scrollAction(
        loc("/entity/x", "tab=news&page=3"),
        loc("/entity/x", "tab=announce"),
      ),
    ).toBe("none");
  });

  it("换到另一个实体页要复位，即使 tab 一样", () => {
    expect(
      scrollAction(loc("/entity/x", "tab=news"), loc("/entity/y", "tab=news")),
    ).toBe("top");
  });

  it("首次挂载不复位（没有「上一个位置」可言）", () => {
    expect(scrollAction(null, loc("/entity/x", "tab=announce"))).toBe("none");
  });

  it("位置没变就不折腾", () => {
    expect(
      scrollAction(loc("/entity/x", "tab=news"), loc("/entity/x", "tab=news")),
    ).toBe("none");
  });

  it("其它 query 变化（搜索词等）仍然回整页顶部", () => {
    expect(scrollAction(loc("/discover", "q=a"), loc("/discover", "q=b"))).toBe(
      "top",
    );
  });

  it("参数顺序不同但内容相同的 tab，不算切换", () => {
    expect(
      scrollAction(
        loc("/entity/x", "page=2&tab=news"),
        loc("/entity/x", "tab=news&page=2"),
      ),
    ).toBe("none");
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
