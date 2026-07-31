import {
  COMMODITY_MAP,
  COMMODITY_SYMS,
  parseSinaFutures,
  commodityEvidence,
  type ExtraEvidence,
} from "../../lib/radar/commodity";

/**
 * 拉一次产业链商品行情 → 按板块归好的催化证据。
 *
 * 放在 `server/radar/` 而不是 `load.ts` 里：`loadMarket` 是纯取库的，
 * 回测要按交易日回放它几十次，塞一个外网请求进去等于把回测钉死在网络上。
 * 而且商品行情是**当下快照、没有历史**，回测本来也用不了它——
 * 所以它只在 `generate.ts` 的实时路径上取一次。
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type CommodityResult = {
  /** 板块名 → 该板块今天的商品价格证据（可能多条） */
  bySector: Map<string, ExtraEvidence[]>;
  /** 取到几个品种（用来把"今天没有价格催化"和"接口挂了"分开） */
  quotes: number;
  /** 其中够得上催化门槛的几条 */
  material: number;
};

const EMPTY: CommodityResult = { bySector: new Map(), quotes: 0, material: 0 };

export async function fetchCommodityCatalysts(
  day: string,
  timeoutMs = 8000,
): Promise<CommodityResult> {
  try {
    const res = await fetch(`https://hq.sinajs.cn/list=${COMMODITY_SYMS.join(",")}`, {
      headers: { "User-Agent": UA, Referer: "https://finance.sina.com.cn" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return EMPTY;
    // 新浪这个端点是 GBK，用 text() 会把品种名解成乱码
    const raw = new TextDecoder("gbk").decode(await res.arrayBuffer());
    const quotes = parseSinaFutures(raw);
    const bySym = new Map(quotes.map((q) => [q.sym, q]));

    const bySector = new Map<string, ExtraEvidence[]>();
    let material = 0;
    for (const def of COMMODITY_MAP) {
      const q = bySym.get(def.sym);
      if (!q) continue;
      const ev = commodityEvidence(q, def.name, def.unit, day);
      if (!ev) continue;
      material++;
      for (const sector of def.sectors) {
        const arr = bySector.get(sector);
        if (arr) arr.push(ev);
        else bySector.set(sector, [ev]);
      }
    }
    return { bySector, quotes: quotes.length, material };
  } catch (e) {
    // 不裸 catch：源端点变了会 100% 失败，静默会让价格催化永久消失且无人发现
    console.error(
      "[radar] 商品行情取不到（本轮无价格催化）：",
      e instanceof Error ? e.message : e,
    );
    return EMPTY;
  }
}
