// 自选列表的展示口径（sway 直报 ⑤：「有的有股票代码，有的没有」）。
//
// 根子还是 COMPANY / STOCK 孪生实体：股票代码不是一个字段，而是**烙在 STOCK 名字里的字符串**
// —— 实测 STOCK 名 100% 带 `(6位代码)`（2000/2000），COMPANY 0%，且 COMPANY 的 `ticker`
// 字段 5498 家全为 null。侧栏只渲染 `entity.name`，于是「从搜索加的」（归一到 COMPANY）没代码、
// 「从发现页/资讯 chip 加的」（STOCK）有代码，同一份列表两种长相。
//
// 这里统一成「名字 + 代码」两行：代码优先用自己的，没有就借它发行股票的；股票那份把名字里的
// 代码拆出来放副行，免得出现「东山精密(002384) 002384」。板块/人物没有代码，副行退回类型标签。

import type { EntityType } from "../../generated/prisma";
import { entityTypeLabel } from "./format";

/** 尾部的 `(6位代码)` —— A 股代码固定 6 位，写死位数才不会误伤「某某(集团)」这种括号。 */
const TRAILING_CODE = /^(.*)\((\d{6})\)$/;

/** 把「东山精密(002384)」拆成名字与代码；没有尾部代码就原样返回。 */
export function splitNameCode(name: string): {
  name: string;
  code: string | null;
} {
  const m = TRAILING_CODE.exec(name);
  return m ? { name: m[1]!, code: m[2]! } : { name, code: null };
}

export type WatchEntityInput = {
  name: string;
  type: EntityType;
  ticker: string | null;
  /** 该实体**发行**的股票的代码（COMPANY 才有；由 ISSUES 关系查得）。 */
  issuedTicker?: string | null;
};

/**
 * 自选条目的两行展示：主行是名字（已剥掉代码），副行是代码；
 * 拿不到代码的（板块 / 人物 / 未上市公司）副行退回类型标签，不留空。
 */
export function watchEntityLabel(e: WatchEntityInput): {
  name: string;
  sub: string;
} {
  const { name, code } = splitNameCode(e.name);
  const ticker = e.ticker ?? code ?? e.issuedTicker ?? null;
  return { name, sub: ticker ?? entityTypeLabel(e.type) };
}

/**
 * 「名字 + 代码」合成一行，用于页头标题、卡片标题这类**只有一行**的位置
 * （张楚寒 2026-07-30：「现在有的公司有代码有的没有，不然都加上代码吧」——
 * 他截图里 `东山精密(002384)` 有码而 `长鑫科技` 没有，正是孪生实体两侧的差别：
 * 实测 5498 家 COMPANY 的 `ticker` 全为 null、名字里也全无代码，而 5500 只 STOCK 名字里 100% 有）。
 *
 * **幂等**：名字里已经带代码就原样返回，不会拼成「东山精密(002384)(002384)」。
 * 拿不到代码（板块 / 人物 / 未上市公司，实测只有 2 家）就返回原名，不留空括号。
 */
export function nameWithCode(
  name: string,
  ticker?: string | null,
  issuedTicker?: string | null,
): string {
  const { name: bare, code } = splitNameCode(name);
  const t = code ?? ticker ?? issuedTicker ?? null;
  return t ? `${bare}(${t})` : bare;
}
