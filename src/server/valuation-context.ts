// 相对导入（不用 ~ 别名）：让 src/scripts/*.ts 走 tsx 也能引用（tsx 不解析 tsconfig paths）。
import {
  parseValuationRows,
  buildValuationContext,
  type ValuationContext,
} from "../lib/valuation-context";

/**
 * 估值对照系的抓取（东财 `RPT_VALUEANALYSIS_DET`）：
 *  ① 按股票代码倒序拉 500 个交易日 → 自身 PE 历史 + 所属行业 BOARD_CODE；
 *  ② 按 BOARD_CODE + 最新交易日拉同行 → 行业 PE 中位数。
 *
 * 两步是**串行**的（第二步要第一步给出的 BOARD_CODE），所以它必须待在自己的
 * `<Suspense>` 里，不能挂到行情卡或页面主链路上。任一步失败返回 null——
 * 东财对本节点间歇封锁，这块看不到就看不到，不拖累别的内容。
 */

const API = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const COLUMNS = "SECURITY_CODE,TRADE_DATE,PE_TTM,PB_MRQ,PS_TTM,BOARD_CODE,BOARD_NAME";

async function get(filter: string, extra: string): Promise<unknown> {
  const url = `${API}?reportName=RPT_VALUEANALYSIS_DET&columns=${COLUMNS}${extra}&filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return (await res.json()) as unknown;
}

/** 纯 A 股 6 位代码；其他市场该报表没有数据。 */
function plainCode(ticker: string): string | null {
  const c = ticker.trim();
  return /^\d{6}$/.test(c) ? c : null;
}

export async function fetchValuationContext(
  ticker: string,
): Promise<ValuationContext | null> {
  const code = plainCode(ticker);
  if (!code) return null;

  try {
    const hist = parseValuationRows(
      await get(
        `(SECURITY_CODE="${code}")`,
        "&pageNumber=1&pageSize=500&sortColumns=TRADE_DATE&sortTypes=-1",
      ),
    );
    const latest = hist[0];
    if (!latest) return null;

    let peerPes: number[] = [];
    if (latest.boardCode) {
      const peers = parseValuationRows(
        await get(
          `(BOARD_CODE="${latest.boardCode}")(TRADE_DATE='${latest.day}')`,
          "&pageNumber=1&pageSize=500&sortColumns=PE_TTM&sortTypes=1",
        ),
      );
      peerPes = peers
        .map((p) => p.peTtm)
        .filter((v): v is number => v !== null);
    }

    return buildValuationContext({
      history: hist,
      peerPes,
      boardName: latest.boardName,
    });
  } catch (e) {
    // 记日志不静默：源端点变了会 100% 失败，裸 catch 会零痕迹永久跳过。
    console.error(
      "[valuation-context] failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
