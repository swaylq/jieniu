// 相对导入（不用 ~ 别名）：让 cron 脚本走 tsx 也能引用 fetchQuote（tsx 不解析 tsconfig paths）。
import {
  parseEastmoneyTicks,
  parseSinaIndex,
  parseSinaQuote,
  parseTencentQuote,
  parseValuation,
  parseTencentValuation,
  hasValuation,
  tickerToSecid,
  tickerToSymbol,
  type EastmoneyTick,
  type IndexMarket,
  type Quote,
  type Valuation,
} from "../lib/quote";

export type LiveQuote = Quote & { symbol: string };

/**
 * 抓客观估值指标（市盈率动/市净率/总市值/流通市值/换手率）。失败返回 null（不抛）。
 * 主源东财 push2 JSON；**push2 对本节点间歇封锁（实测连续多轮 0/10），失败即回退腾讯
 * qt.gtimg**（腾讯本就是现价备源，其行情串含全部估值字段，零新增主机依赖）。
 */
export async function fetchValuation(ticker: string): Promise<Valuation | null> {
  const secid = tickerToSecid(ticker);
  if (secid) {
    try {
      const res = await fetch(
        `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}` +
          `&fields=f116,f117,f162,f167,f168&ut=fa5fd1943c7b386f172d6893dbfba10b`,
        {
          headers: { Referer: "https://quote.eastmoney.com" },
          cache: "no-store",
          signal: AbortSignal.timeout(6000),
        },
      );
      if (res.ok) {
        const j = (await res.json()) as {
          data?: Record<string, unknown> | null;
        };
        if (j.data) {
          const v = parseValuation(j.data);
          if (hasValuation(v)) return v;
        }
      }
    } catch {
      // push2 不可达 → 落到腾讯兜底
    }
  }

  // 兜底：腾讯 qt.gtimg（GBK，行情串含估值字段）
  const symbol = tickerToSymbol(ticker);
  if (!symbol) return null;
  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${symbol}`, {
      headers: { Referer: "https://gu.qq.com" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const raw = new TextDecoder("gbk").decode(await res.arrayBuffer());
    const v = parseTencentValuation(raw);
    return hasValuation(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 抓 A股实时行情：**主源腾讯 qt.gtimg、备源新浪 hq.sinajs**，均 GBK；失败返回 null（不抛）。
 *
 * 主备顺序 2026-09-02 对调：`hq.sinajs.cn` 对阿里云机房出口（线上这台 ECS）先挂起 5 秒再返回
 * 403，也就是每次取行情都白等 5 秒才轮到备源。腾讯从这台机器 0.12 秒返回、字段也齐。
 * 新浪留在后面，本地开发和将来解封都还走得通。
 */
export async function fetchQuote(ticker: string): Promise<LiveQuote | null> {
  const symbol = tickerToSymbol(ticker);
  if (!symbol) return null;

  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${symbol}`, {
      headers: { Referer: "https://gu.qq.com" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const raw = new TextDecoder("gbk").decode(await res.arrayBuffer());
      const q = parseTencentQuote(raw);
      if (q) return { ...q, symbol };
    }
  } catch {
    // fall through to backup source
  }

  try {
    const res = await fetch(`https://hq.sinajs.cn/list=${symbol}`, {
      headers: { Referer: "https://finance.sina.com.cn" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const raw = new TextDecoder("gbk").decode(await res.arrayBuffer());
      const q = parseSinaQuote(raw);
      if (q) return { ...q, symbol };
    }
  } catch {
    // give up
  }

  return null;
}

/**
 * 东财批量行情：一次请求取一串 `secid`，返回 `secid → 行情`。全部取不到时返回空 Map（不抛）。
 *
 * 两台主机依次试：`push2` 是实时的但对本节点间歇封锁（见 `fetchValuation` 同款注释），
 * `push2delay` 稳定得多。任一台给出至少一条就用它的结果，不做逐条拼接——
 * 混两台的数据会让同一屏上的品种来自不同时刻。
 */
const EASTMONEY_HOSTS = [
  "https://push2.eastmoney.com",
  "https://push2delay.eastmoney.com",
];

export async function fetchEastmoneyTicks(
  secids: string[],
  timeoutMs = 6000,
): Promise<Map<string, EastmoneyTick>> {
  if (secids.length === 0) return new Map();
  const qs =
    `?fields=f2,f3,f12,f13,f14&fltt=2&secids=${secids.join(",")}` +
    `&ut=fa5fd1943c7b386f172d6893dbfba10b`;
  for (const host of EASTMONEY_HOSTS) {
    try {
      const res = await fetch(`${host}/api/qt/ulist.np/get${qs}`, {
        headers: { Referer: "https://quote.eastmoney.com" },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const ticks = parseEastmoneyTicks(await res.json());
      if (ticks.size > 0) return ticks;
    } catch {
      // 换下一台
    }
  }
  return new Map();
}

/** 抓近 N 日日K收盘序列（新浪），供实体页迷你走势图；任何失败返回 []（不抛）。 */
export async function fetchKline(ticker: string, days = 30): Promise<number[]> {
  const symbol = tickerToSymbol(ticker);
  if (!symbol) return [];
  try {
    const res = await fetch(
      `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${days}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://finance.sina.com.cn",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    const arr = (await res.json()) as { close?: string }[];
    return arr
      .map((d) => Number(d.close))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/**
 * 概览条覆盖的指数：沪深 → 港股 → 美股 → 商品，顺序即展示顺序。
 * 每条同时记两个源的代号：`secid` 是东财（主源），`symbol` 是新浪（兜底）。
 * 两边实测同一时刻同价，12 个品种一一对得上。
 */
const INDEX_SYMBOLS: {
  secid: string;
  symbol: string;
  label: string;
  market: IndexMarket;
}[] = [
  { secid: "1.000001", symbol: "sh000001", label: "上证指数", market: "cn" },
  { secid: "0.399001", symbol: "sz399001", label: "深证成指", market: "cn" },
  { secid: "0.399006", symbol: "sz399006", label: "创业板指", market: "cn" },
  { secid: "1.000688", symbol: "sh000688", label: "科创50", market: "cn" },
  { secid: "1.000300", symbol: "sh000300", label: "沪深300", market: "cn" },
  { secid: "100.HSI", symbol: "rt_hkHSI", label: "恒生指数", market: "hk" },
  { secid: "124.HSTECH", symbol: "rt_hkHSTECH", label: "恒生科技", market: "hk" },
  { secid: "100.DJIA", symbol: "gb_dji", label: "道琼斯", market: "us" },
  { secid: "100.NDX", symbol: "gb_ixic", label: "纳斯达克", market: "us" },
  { secid: "100.SPX", symbol: "gb_inx", label: "标普500", market: "us" },
  // 外盘商品：黄金/原油是 A 股周期股与通胀交易的先行指标，属宏观底色。
  // 取纽约期货连续（COMEX 黄金 / NYMEX WTI）——与伦敦金现 hf_XAU、布伦特 hf_OIL
  // 实测涨跌幅同向且幅度一致，选纽约是因为国内财经端普遍以它为准，标签才对得上读者预期。
  { secid: "101.GC00Y", symbol: "hf_GC", label: "纽约黄金", market: "cmdty" },
  { secid: "102.CL00Y", symbol: "hf_CL", label: "纽约原油", market: "cmdty" },
];

export type IndexQuote = {
  symbol: string;
  label: string;
  market: IndexMarket;
  price: number;
  changePct: number;
};

/**
 * 抓主要指数行情，供首页顶部市场概览条。A股/港股/美股/商品一次批量拿。
 * 港美在 A 股交易时段显示的是上一交易日收盘，属正常（各家财经端一致），UI 按市场分组标注。
 * 失败返回 []（不抛）。
 *
 * **主源东财、兜底新浪**（2026-09-02 对调）。原来只有新浪一个源，8-27 迁到阿里云 ECS 之后
 * `hq.sinajs.cn` 对这个机房出口一律 403，这条没有备源的链路直接让整条概览条从首页消失了
 * 六天——概览条 `data.length === 0` 就整条隐藏，前端看不出是「没数据」还是「没这个功能」。
 * 所以这里除了加备源，两个源都空时还要 `console.error`，好让每日体检 grep 得到。
 */
export async function fetchIndexQuotes(): Promise<IndexQuote[]> {
  const ticks = await fetchEastmoneyTicks(INDEX_SYMBOLS.map((i) => i.secid));
  const fromEastmoney: IndexQuote[] = [];
  for (const idx of INDEX_SYMBOLS) {
    const t = ticks.get(idx.secid);
    if (!t) continue;
    fromEastmoney.push({
      symbol: idx.symbol,
      label: idx.label,
      market: idx.market,
      price: t.price,
      changePct: t.changePct,
    });
  }
  if (fromEastmoney.length > 0) return fromEastmoney;

  const fromSina = await fetchIndexQuotesSina();
  if (fromSina.length === 0) {
    console.error(
      "[quote] 指数概览条无数据：东财与新浪两个源都没返回，首页顶栏会整条消失",
    );
  }
  return fromSina;
}

/** 新浪指数行情（概览条的兜底源）。失败返回 []（不抛）。 */
async function fetchIndexQuotesSina(): Promise<IndexQuote[]> {
  try {
    const list = INDEX_SYMBOLS.map((i) => i.symbol).join(",");
    const res = await fetch(`https://hq.sinajs.cn/list=${list}`, {
      headers: { Referer: "https://finance.sina.com.cn" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const raw = new TextDecoder("gbk").decode(await res.arrayBuffer());
    const lines = raw.split("\n");
    const out: IndexQuote[] = [];
    for (const idx of INDEX_SYMBOLS) {
      // 精确匹配 `hq_str_<symbol>=`：symbol 之间存在子串关系（rt_hkHSI ⊂ 不了 HSTECH，
      // 但 sh000300/sh000688 之类未来易撞），松匹配会串行拿到别的指数。
      const line = lines.find((l) => l.includes(`hq_str_${idx.symbol}=`));
      if (!line) continue;
      const q = parseSinaIndex(line, idx.market);
      if (q) {
        out.push({
          symbol: idx.symbol,
          label: idx.label,
          market: idx.market,
          price: q.price,
          changePct: q.changePct,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}
