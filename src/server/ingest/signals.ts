import type { PrismaClient } from "../../../generated/prisma";

// 个股结构化信号填充（数据类源，非事件）——写入 EntitySignal，每 (实体,kind) 只留最新一条。
// margin 融资余额 / consensus 一致预期(脱敏) / unlock 下次限售解禁(前瞻)。数据类走东财数据中心。

const API = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type SignalUpsert = {
  kind: string;
  label: string;
  numValue: number | null;
  detail: unknown;
  asOf: Date;
};

/** CST 日期串（"2026-07-23 00:00:00"）→ 该日东八区零点 Date；非法返回 null。 */
function cstDate(s: string | undefined): Date | null {
  const d = (s ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return new Date(`${d}T00:00:00+08:00`);
}

// ── 纯转换（TDD）──────────────────────────────────────────────────────────

export type MarginRow = { SCODE?: string; RZYE?: number; RZYEZB?: number; DATE?: string };
/** 融资余额信号。无余额返回 null。 */
export function marginSignal(row: MarginRow): SignalUpsert | null {
  const rzye = typeof row.RZYE === "number" ? row.RZYE : null;
  const asOf = cstDate(row.DATE);
  if (rzye === null || rzye <= 0 || !asOf) return null;
  const yi = Number((rzye / 1e8).toFixed(2));
  const zb = typeof row.RZYEZB === "number" ? Number(row.RZYEZB.toFixed(2)) : null;
  const label = `融资余额${yi}亿${zb !== null ? `，占流通${zb}%` : ""}`;
  return { kind: "margin", label, numValue: zb, detail: { rzye, rzyezb: zb }, asOf };
}

export type ConsensusRow = {
  SECURITY_CODE?: string;
  RATING_ORG_NUM?: number;
  RATING_BUY_NUM?: number;
  RATING_ADD_NUM?: number;
  RATING_NEUTRAL_NUM?: number;
  EPS1?: number;
  YEAR1?: string;
  EPS2?: number;
  YEAR2?: string;
  // DEC_AIMPRICEMIN/MAX 刻意**不**进入本类型——从源头杜绝目标价误用（铁律②）。
};
/** 一致预期信号（合规脱敏：只留覆盖机构数/评级分布/EPS，绝不含目标价）。无机构覆盖返回 null。 */
export function consensusSignal(row: ConsensusRow): SignalUpsert | null {
  const org = typeof row.RATING_ORG_NUM === "number" ? row.RATING_ORG_NUM : 0;
  if (org <= 0) return null;
  const buy = row.RATING_BUY_NUM ?? 0;
  const add = row.RATING_ADD_NUM ?? 0;
  const neutral = row.RATING_NEUTRAL_NUM ?? 0;
  const parts: string[] = [];
  if (buy) parts.push(`买入${buy}`);
  if (add) parts.push(`增持${add}`);
  if (neutral) parts.push(`中性${neutral}`);
  const label = `${org}家机构覆盖${parts.length ? `，${parts.join("/")}` : ""}`;
  const eps: { year: string; eps: number }[] = [];
  if (typeof row.EPS1 === "number" && row.YEAR1) eps.push({ year: row.YEAR1, eps: Number(row.EPS1.toFixed(2)) });
  if (typeof row.EPS2 === "number" && row.YEAR2) eps.push({ year: row.YEAR2, eps: Number(row.EPS2.toFixed(2)) });
  return {
    kind: "consensus",
    label,
    numValue: org,
    detail: { orgNum: org, buy, add, neutral, eps },
    asOf: new Date(),
  };
}

export type UnlockRow = {
  SECURITY_CODE?: string;
  FREE_DATE?: string;
  FREE_RATIO?: number;
  FREE_SHARES_TYPE?: string;
};
/** 下次限售解禁信号（前瞻）。无解禁日返回 null。 */
export function unlockSignal(row: UnlockRow): SignalUpsert | null {
  const asOf = cstDate(row.FREE_DATE);
  if (!asOf) return null;
  const ratio = typeof row.FREE_RATIO === "number" ? Number(row.FREE_RATIO.toFixed(2)) : null;
  const md = row.FREE_DATE!.slice(5, 10);
  const type = (row.FREE_SHARES_TYPE ?? "").trim();
  const label = `${md} 解禁${ratio !== null ? `${ratio}%流通盘` : ""}${type ? `（${type}）` : ""}`;
  return { kind: "unlock", label, numValue: ratio, detail: { freeDate: row.FREE_DATE!.slice(0, 10), ratio, type }, asOf };
}

/** 产业链大宗商品价格 → 板块信号（挂 SECTOR 实体）。价格 ≤0 返回 null。 */
export function commodityToSignal(
  name: string,
  price: number,
  changePct: number,
  unit: string,
): SignalUpsert | null {
  if (!(price > 0)) return null;
  const chg = Number(changePct.toFixed(2));
  const sign = chg > 0 ? "+" : "";
  const label = `${name} ${price}${unit} ${sign}${chg}%`;
  return {
    kind: "commodity",
    label,
    numValue: chg,
    detail: { name, price, changePct: chg, unit },
    asOf: new Date(),
  };
}

/** 台股月营收（千元）→ 半导体先行指标信号。营收 ≤0 返回 null。 */
export function taiwanRevenueToSignal(
  name: string,
  revenueQianYuan: number,
  yoyPct: number,
): SignalUpsert | null {
  if (!(revenueQianYuan > 0)) return null;
  const yi = Number((revenueQianYuan / 1e5).toFixed(0)); // 千元 → 亿（÷1e5）
  const yoy = Number(yoyPct.toFixed(1));
  const sign = yoy > 0 ? "+" : "";
  const label = `${name}月营收${yi}亿台币，同比${sign}${yoy}%`;
  return {
    kind: "overseas",
    label,
    numValue: yoy,
    detail: { name, revenueYi: yi, yoyPct: yoy },
    asOf: new Date(),
  };
}

// ── 填充（integration）────────────────────────────────────────────────────

async function fetchReport<T>(reportName: string, extra = "", page = 1): Promise<T[]> {
  const url = `${API}?reportName=${reportName}&columns=ALL&pageNumber=${page}&pageSize=500${extra}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`${reportName} ${res.status}`);
  const j = (await res.json()) as { result?: { data?: T[] } };
  return j.result?.data ?? [];
}

/**
 * 填充覆盖池内个股的三类信号（margin/consensus/unlock）到 EntitySignal（upsert 最新）。
 * 返回各类写入条数。任一类失败只跳过该类、不中断（逐类 try/catch）。
 */
export async function populateSignals(
  db: PrismaClient,
): Promise<{ margin: number; consensus: number; unlock: number }> {
  const stocks = await db.entity.findMany({
    where: { type: "STOCK", ticker: { not: null } },
    select: { id: true, ticker: true },
  });
  const idByCode = new Map(stocks.map((s) => [s.ticker!, s.id]));
  const result = { margin: 0, consensus: 0, unlock: 0 };

  const upsert = async (entityId: string, s: SignalUpsert) => {
    await db.entitySignal.upsert({
      where: { entityId_kind: { entityId, kind: s.kind } },
      create: {
        entityId,
        kind: s.kind,
        label: s.label,
        numValue: s.numValue,
        detail: s.detail as object,
        asOf: s.asOf,
      },
      update: { label: s.label, numValue: s.numValue, detail: s.detail as object, asOf: s.asOf },
    });
  };

  // margin：最新一日融资融券个股明细
  try {
    const rows = await fetchReport<MarginRow>("RPTA_WEB_RZRQ_GGMX", "&sortColumns=DATE&sortTypes=-1");
    const latestDate = rows[0]?.DATE?.slice(0, 10);
    for (const r of rows) {
      if (r.DATE?.slice(0, 10) !== latestDate) continue; // 只取最新一日
      const id = idByCode.get((r.SCODE ?? "").trim());
      const s = id ? marginSignal(r) : null;
      if (id && s) { await upsert(id, s); result.margin++; }
    }
  } catch (e) {
    // 记日志不静默（7-24 教训）：某源端点变了会 100% 失败，裸 catch 会零痕迹永久跳过。
    console.error("[signals] margin skipped:", e instanceof Error ? e.message : e);
  }

  // consensus：一致预期（每股一行）
  try {
    for (let p = 1; p <= 4; p++) {
      const rows = await fetchReport<ConsensusRow>("RPT_WEB_RESPREDICT", "", p);
      if (rows.length === 0) break;
      for (const r of rows) {
        const id = idByCode.get((r.SECURITY_CODE ?? "").trim());
        const s = id ? consensusSignal(r) : null;
        if (id && s) { await upsert(id, s); result.consensus++; }
      }
      if (rows.length < 500) break;
    }
  } catch (e) {
    console.error("[signals] consensus skipped:", e instanceof Error ? e.message : e);
  }

  // unlock：未来解禁，每股取最近一次
  try {
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const rows = await fetchReport<UnlockRow>(
      "RPT_LIFT_STAGE",
      `&sortColumns=FREE_DATE&sortTypes=1&filter=${encodeURIComponent(`(FREE_DATE>'${from}')`)}`,
    );
    const seen = new Set<string>();
    for (const r of rows) {
      const code = (r.SECURITY_CODE ?? "").trim();
      if (seen.has(code)) continue; // 已升序，首个即最近一次
      const id = idByCode.get(code);
      const s = id ? unlockSignal(r) : null;
      if (id && s) { seen.add(code); await upsert(id, s); result.unlock++; }
    }
  } catch (e) {
    console.error("[signals] unlock skipped:", e instanceof Error ? e.message : e);
  }

  return result;
}

// 产业链大宗商品 → 板块（一板块一代表品种，避免 (entity,kind) 唯一键冲突）。
const COMMODITY_MAP = [
  { sym: "nf_LC0", name: "碳酸锂", sector: "新能源", unit: "元/吨" },
  { sym: "nf_PS0", name: "多晶硅", sector: "光伏", unit: "元/吨" },
];

/**
 * 填充板块级信号（数据类·定向，按 §八 关联广度门控——只挂相关板块）：
 * 产业链价格（新浪期货 → 板块 commodity 信号）+ 台股月营收（TSMC → 半导体 overseas 信号）。
 * 挂在 SECTOR 实体上，个股页/板块页的 SignalStrip 复用展示。返回写入条数。
 */
export async function populateSectorSignals(
  db: PrismaClient,
): Promise<{ commodity: number; overseas: number }> {
  const sectors = await db.entity.findMany({
    where: { type: "SECTOR" },
    select: { id: true, name: true },
  });
  const sectorByName = new Map(sectors.map((s) => [s.name, s.id]));
  const result = { commodity: 0, overseas: 0 };

  const upsert = async (entityId: string, s: SignalUpsert) => {
    await db.entitySignal.upsert({
      where: { entityId_kind: { entityId, kind: s.kind } },
      create: { entityId, kind: s.kind, label: s.label, numValue: s.numValue, detail: s.detail as object, asOf: s.asOf },
      update: { label: s.label, numValue: s.numValue, detail: s.detail as object, asOf: s.asOf },
    });
  };

  // 产业链价格：新浪期货（GBK），主力连续 nf_<品种>0；[8]最新价 [10]昨结。
  try {
    const list = COMMODITY_MAP.map((c) => c.sym).join(",");
    const res = await fetch(`https://hq.sinajs.cn/list=${list}`, {
      headers: { Referer: "https://finance.sina.com.cn" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const raw = new TextDecoder("gbk").decode(await res.arrayBuffer());
      const lines = raw.split("\n");
      for (const c of COMMODITY_MAP) {
        const sid = sectorByName.get(c.sector);
        if (!sid) continue;
        const line = lines.find((l) => l.includes(`hq_str_${c.sym}=`));
        const f = (/="([^"]*)"/.exec(line ?? "")?.[1] ?? "").split(",");
        const price = Number(f[8]);
        const prev = Number(f[10]);
        if (!Number.isFinite(price) || !Number.isFinite(prev) || prev <= 0) continue;
        const chg = ((price - prev) / prev) * 100;
        const s = commodityToSignal(c.name, price, chg, c.unit);
        if (s) { await upsert(sid, s); result.commodity++; }
      }
    }
  } catch (e) {
    console.error("[signals] commodity skipped:", e instanceof Error ? e.message : e);
  }

  // 台股月营收：TWSE OpenAPI（TSMC 2330 → 半导体先行指标）。
  try {
    const semiId = sectorByName.get("半导体");
    if (semiId) {
      const res = await fetch("https://openapi.twse.com.tw/v1/opendata/t187ap05_L", {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const arr = (await res.json()) as Record<string, string>[];
        const tsmc = arr.find((x) => x["公司代號"] === "2330");
        if (tsmc) {
          const rev = Number(tsmc["營業收入-當月營收"]);
          const yoy = Number(tsmc["營業收入-去年同月增減(%)"]);
          const s = taiwanRevenueToSignal("台积电", rev, Number.isFinite(yoy) ? yoy : 0);
          if (s) { await upsert(semiId, s); result.overseas++; }
        }
      }
    }
  } catch (e) {
    console.error("[signals] overseas skipped:", e instanceof Error ? e.message : e);
  }

  return result;
}
