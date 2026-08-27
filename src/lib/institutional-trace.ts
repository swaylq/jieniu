/**
 * 「机构痕迹」的解析与聚合层（纯函数、无 IO、可测）。
 *
 * 这一层和 `fund-flow.ts` 是**两个物种**，别混：
 *  · `fund-flow` 是按单笔成交金额分档**估算**出来的，跨源能差 20 倍；
 *  · 这里全部是**交易所披露的原始事实**——席位名、成交价、买卖金额，有出处、有日期。
 *
 * 覆盖面很窄，这是它的性质不是缺陷：2026-08-27 实测，全市场 5900 只里
 * 龙虎榜有机构专用席位的每天 35~69 只、大宗交易买方是机构专用的每天 9~22 只。
 * **所以它不能做成个股页的常驻卡**（5850 只天天空态就是噪音），
 * 只在当天真的亮了才显示，另有一条全市场信号流。
 *
 * 三条必须守住的口径（每条都有实测支撑）：
 *
 * ① **席位名只认精确匹配。** 交易所规则里「机构专用」是一个**固定名称**
 *    （深交所《交易规则》5.4.7、上交所 5.4.8：涉及机构/机构专用交易单元的，公布名称为"机构专用"）。
 *    用「包含『机构』」去筛会把「申万宏源证券有限公司机构客户总部」这种普通营业部
 *    错当成机构席位——2026-08-27 当天就有一条。
 *
 * ② **必须挡住「投资者分类交易统计」。** 严重异常波动的股票会附一张完全不同的表，
 *    它的「席位名」其实是投资者类别（自然人 / 其中:中小投资者 / 其他自然人 / 机构 / 深股通），
 *    金额是**区间累计**、量级是普通席位的百倍。深交所自己用不同报表 ID 分开，
 *    但东财和数据商把两者合并了。精确匹配同时解决了这一条：类别名是「机构」「深股通」，
 *    席位名是「机构专用」「深股通专用」，差两个字。
 *
 * ③ **大宗交易必须先合并拆单。** 一笔减持常被拆成多笔同价成交——2026-08-26
 *    河钢资源同价 16.20 拆 4 笔、8-27 富创精密同一卖方同价对 6 个买方成交 6 笔。
 *    按笔数统计会严重高估活跃度，所以先按 (日期, 代码, 成交价, 买方, 卖方) 去重再聚合。
 */

// ---------------------------------------------------------------------------
// 席位名判定
// ---------------------------------------------------------------------------

/** 交易所对机构席位的**固定公布名称**。见文件头 ①。 */
export const SEAT_INSTITUTION = "机构专用";
/** 北向席位。它们**有真实席位代码**，和匿名的「机构专用」不是一回事。 */
export const SEAT_HSGT = ["沪股通专用", "深股通专用"] as const;

/** 交易所侧的名字带全角空格/`&nbsp;`，比对前先规整。 */
export function normalizeSeat(name: string): string {
  return name
    .replace(/&nbsp;/g, " ")
    .replace(/[　\s]/g, "")
    .trim();
}

/** 是不是机构专用席位。**精确匹配**——理由见文件头 ① ②。 */
export function isInstitutionSeat(name: string | null | undefined): boolean {
  return !!name && normalizeSeat(name) === SEAT_INSTITUTION;
}

/** 是不是北向专用席位，返回具体是沪还是深。 */
export function hsgtSeat(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = normalizeSeat(name);
  return (SEAT_HSGT as readonly string[]).includes(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 输入行（东财 datacenter 的原始形状，只取我们用得到的字段）
// ---------------------------------------------------------------------------

export type OrgRow = {
  SECURITY_CODE: string;
  TRADE_DATE: string;
  BUY_TIMES: number | null;
  SELL_TIMES: number | null;
  BUY_AMT: number | null;
  SELL_AMT: number | null;
  NET_BUY_AMT: number | null;
};

export type SeatRow = {
  SECURITY_CODE: string;
  TRADE_DATE: string;
  OPERATEDEPT_NAME: string | null;
  BUY: number | null;
  SELL: number | null;
};

export type BlockRow = {
  SECURITY_CODE: string;
  TRADE_DATE: string;
  DEAL_PRICE: number | null;
  CLOSE_PRICE: number | null;
  PREMIUM_RATIO: number | null;
  DEAL_AMT: number | null;
  BUYER_NAME: string | null;
  SELLER_NAME: string | null;
};

export type Trace = {
  ticker: string;
  tradeDate: string; // YYYY-MM-DD
  kind: "lhb_inst" | "lhb_hsgt" | "block_inst";
  netAmount: number;
  buyAmount: number;
  sellAmount: number;
  detail: Record<string, unknown>;
};

function day(s: string): string {
  return s.slice(0, 10);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

/**
 * 龙虎榜机构席位（`RPT_ORGANIZATION_TRADE_DETAILS`）。
 *
 * **同一只股同一天可能有多行**——每条上榜理由一行，2026-08-27 实测 43 行 / 37 只股。
 * 各行的前五席位互相重叠，**求和会重复计数**。这里取「买卖席位数之和最大」的那一行：
 * 它最接近各理由席位的并集，且永远不会把同一笔算两遍。并列时取净额绝对值大的。
 */
export function aggregateOrgRows(rows: OrgRow[]): Trace[] {
  const best = new Map<string, OrgRow>();
  for (const r of rows) {
    if (!r.SECURITY_CODE || !r.TRADE_DATE) continue;
    const key = `${r.SECURITY_CODE}|${day(r.TRADE_DATE)}`;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, r);
      continue;
    }
    const seats = (x: OrgRow) => num(x.BUY_TIMES) + num(x.SELL_TIMES);
    if (
      seats(r) > seats(cur) ||
      (seats(r) === seats(cur) &&
        Math.abs(num(r.NET_BUY_AMT)) > Math.abs(num(cur.NET_BUY_AMT)))
    ) {
      best.set(key, r);
    }
  }
  return [...best.values()].map((r) => ({
    ticker: r.SECURITY_CODE,
    tradeDate: day(r.TRADE_DATE),
    kind: "lhb_inst" as const,
    netAmount: num(r.NET_BUY_AMT),
    buyAmount: num(r.BUY_AMT),
    sellAmount: num(r.SELL_AMT),
    detail: { buySeats: num(r.BUY_TIMES), sellSeats: num(r.SELL_TIMES) },
  }));
}

/**
 * 龙虎榜北向专用席位（买卖两张明细表）。
 *
 * 同一只股同一天可能有多行北向席位（沪深两个、或多条上榜理由），这里**按股按日求和**——
 * 与机构席位不同，北向席位有真实代码、行与行之间不是同一批席位的重复列示。
 */
export function aggregateHsgtSeats(rows: SeatRow[]): Trace[] {
  const acc = new Map<string, { buy: number; sell: number; seats: Set<string> }>();
  for (const r of rows) {
    const seat = hsgtSeat(r.OPERATEDEPT_NAME);
    if (!seat || !r.SECURITY_CODE || !r.TRADE_DATE) continue;
    const key = `${r.SECURITY_CODE}|${day(r.TRADE_DATE)}`;
    const cur = acc.get(key) ?? { buy: 0, sell: 0, seats: new Set<string>() };
    cur.buy += num(r.BUY);
    cur.sell += num(r.SELL);
    cur.seats.add(seat);
    acc.set(key, cur);
  }
  return [...acc.entries()].map(([key, v]) => {
    const [ticker, tradeDate] = key.split("|") as [string, string];
    return {
      ticker,
      tradeDate,
      kind: "lhb_hsgt" as const,
      netAmount: v.buy - v.sell,
      buyAmount: v.buy,
      sellAmount: v.sell,
      detail: { seats: [...v.seats].sort() },
    };
  });
}

/**
 * 大宗交易里买卖任一方是机构专用的部分。
 *
 * 先按 (日期, 代码, 成交价, 买方, 卖方) **合并拆单**（见文件头 ③），再按股按日聚合。
 * `netAmount` 的符号约定：机构是买方记正、是卖方记负；两边都是机构专用则相抵为 0，
 * 但仍记一条（金额本身有信息，方向没有）。
 *
 * 折溢价率是**数据商自算的**（成交价 ÷ 当日收盘价 − 1），交易所不发布这一列，
 * 所以存进 detail 时一并记下参考价，将来换源才对得上。
 */
export function aggregateBlockTrades(rows: BlockRow[]): Trace[] {
  const seen = new Set<string>();
  const acc = new Map<
    string,
    { buy: number; sell: number; deals: number; prem: number; amt: number }
  >();
  for (const r of rows) {
    if (!r.SECURITY_CODE || !r.TRADE_DATE) continue;
    const instBuy = isInstitutionSeat(r.BUYER_NAME);
    const instSell = isInstitutionSeat(r.SELLER_NAME);
    if (!instBuy && !instSell) continue;
    const d = day(r.TRADE_DATE);
    // 拆单合并：同日同股同价同买卖方 = 同一笔。
    const dedupe = `${r.SECURITY_CODE}|${d}|${r.DEAL_PRICE}|${normalizeSeat(r.BUYER_NAME ?? "")}|${normalizeSeat(r.SELLER_NAME ?? "")}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const key = `${r.SECURITY_CODE}|${d}`;
    const cur = acc.get(key) ?? { buy: 0, sell: 0, deals: 0, prem: 0, amt: 0 };
    const amt = num(r.DEAL_AMT);
    if (instBuy) cur.buy += amt;
    if (instSell) cur.sell += amt;
    cur.deals += 1;
    // 折溢价按成交额加权——一笔 1 亿的折价 8% 和一笔 100 万的溢价 1%，等权平均会读反。
    cur.prem += num(r.PREMIUM_RATIO) * amt;
    cur.amt += amt;
    acc.set(key, cur);
  }
  return [...acc.entries()].map(([key, v]) => {
    const [ticker, tradeDate] = key.split("|") as [string, string];
    return {
      ticker,
      tradeDate,
      kind: "block_inst" as const,
      netAmount: v.buy - v.sell,
      buyAmount: v.buy,
      sellAmount: v.sell,
      detail: {
        deals: v.deals,
        premiumRatio: v.amt > 0 ? v.prem / v.amt : null,
        premiumRef: "成交价÷当日收盘价−1（数据商口径，交易所不发布此列）",
      },
    };
  });
}

// ---------------------------------------------------------------------------
// 展示
// ---------------------------------------------------------------------------

export const TRACE_LABEL: Record<Trace["kind"], string> = {
  lhb_inst: "龙虎榜 · 机构专用席位",
  lhb_hsgt: "龙虎榜 · 北向专用席位",
  block_inst: "大宗交易 · 机构专用",
};

/**
 * 列表左侧那枚小标签，只说**来源**（龙虎榜 / 大宗交易），不重复正文已经说过的席位类型。
 * 真机截图里原来是「机构专用席位」标签 +「机构专用席位净买入 5.99 亿」正文，同一个词连着出现两次。
 */
export const TRACE_SOURCE: Record<Trace["kind"], string> = {
  lhb_inst: "龙虎榜",
  lhb_hsgt: "龙虎榜",
  block_inst: "大宗交易",
};

/**
 * 一条痕迹的人话。**只陈述披露了什么，不做推断**——
 * 「机构专用」是匿名的，交易所规则里只区分「是不是机构」，
 * 不列举是公募还是险资，所以任何「哪类机构在买」的说法都是编。
 */
export function traceText(t: Trace): string {
  const yi = (v: number) => `${(Math.abs(v) / 1e8).toFixed(2)} 亿`;
  const wan = (v: number) => `${(Math.abs(v) / 1e4).toFixed(0)} 万`;
  const money = (v: number) => (Math.abs(v) >= 1e8 ? yi(v) : wan(v));
  const dir = t.netAmount >= 0 ? "净买入" : "净卖出";
  switch (t.kind) {
    case "lhb_inst": {
      const b = Number(t.detail.buySeats ?? 0);
      const s = Number(t.detail.sellSeats ?? 0);
      return `机构专用席位${dir} ${money(t.netAmount)}（${b} 个席位买入、${s} 个席位卖出）`;
    }
    case "lhb_hsgt": {
      const seats = Array.isArray(t.detail.seats)
        ? (t.detail.seats as string[]).join("、")
        : "北向";
      return `${seats}${dir} ${money(t.netAmount)}`;
    }
    case "block_inst": {
      const p = t.detail.premiumRatio;
      const pt =
        typeof p === "number" && Number.isFinite(p)
          ? `，${p < 0 ? "折价" : "溢价"} ${Math.abs(p).toFixed(1)}%`
          : "";
      const n = Number(t.detail.deals ?? 0);
      if (t.netAmount === 0)
        return `买卖双方均为机构专用席位，成交 ${money(t.buyAmount)}（${n} 笔）${pt}`;
      return `机构专用席位${dir} ${money(t.netAmount)}（${n} 笔）${pt}`;
    }
  }
}
