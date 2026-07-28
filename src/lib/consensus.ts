/**
 * 机构一致预期 · 解析与派生（借鉴富途「牛牛财报站 · AI 大行观点」的**分歧度**呈现）。
 *
 * 数据早已在采（`ingest/signals.ts:consensusSignal` → `EntitySignal.detail`），但界面只渲染了
 * 一行 label（「N 家机构覆盖，买入X/增持Y」），评级分布与未来两年 EPS 预期一直没露出来。
 * 这里是纯函数层：把 `detail` 解析成比例条与 EPS 展望所需的结构。
 *
 * 铁律：
 *  ① 只搬运第三方机构的结论，解牛自己不出方向——所以叫「分歧度」不叫「评级」。
 *  ② 绝不含目标价（源头 `ConsensusRow` 就已剔除 DEC_AIMPRICEMIN/MAX）。
 *  ③ 三档之和小于覆盖机构数时补「未披露」，差额显性化——不隐藏、也不编造归属。
 */

export type ConsensusEps = { year: string; eps: number };

export type ConsensusDetail = {
  orgNum: number;
  buy: number;
  add: number;
  neutral: number;
  eps: ConsensusEps[];
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 解析 `EntitySignal.detail`（Prisma JSON，运行时任意值）。无覆盖或结构不对返回 null。 */
export function parseConsensusDetail(detail: unknown): ConsensusDetail | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const d = detail as Record<string, unknown>;
  const orgNum = num(d.orgNum);
  if (orgNum <= 0) return null;

  const rawEps = Array.isArray(d.eps) ? d.eps : [];
  const eps: ConsensusEps[] = [];
  for (const item of rawEps) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    // year 在库里实际是 **number**（东财返回 2025，不是 "2025"）；只认 string 会把全部
    // EPS 静默丢掉，界面表现为「有机构覆盖却没有预期」。两种类型都接，统一归一成字符串。
    const year =
      typeof e.year === "string"
        ? e.year.trim()
        : typeof e.year === "number" && Number.isFinite(e.year)
          ? String(e.year)
          : "";
    if (!year) continue;
    if (typeof e.eps !== "number" || !Number.isFinite(e.eps)) continue;
    eps.push({ year, eps: e.eps });
  }

  return {
    orgNum,
    buy: num(d.buy),
    add: num(d.add),
    neutral: num(d.neutral),
    eps,
  };
}

export type RatingSliceKey = "buy" | "add" | "neutral" | "other";
export type RatingSlice = {
  key: RatingSliceKey;
  label: string;
  count: number;
  pct: number;
};

const SLICE_LABEL: Record<RatingSliceKey, string> = {
  buy: "买入",
  add: "增持",
  neutral: "中性",
  other: "未披露",
};

/**
 * 评级分布 → 比例条切片。分母是**覆盖机构数**（不是三档之和），差额落到「未披露」。
 * 计数为 0 的档直接不出现（空档位在比例条上是噪音）。
 */
export function ratingBreakdown(d: ConsensusDetail): RatingSlice[] {
  const counted = d.buy + d.add + d.neutral;
  const other = Math.max(0, d.orgNum - counted);
  const total = counted + other;
  if (total <= 0) return [];

  const raw: { key: RatingSliceKey; count: number }[] = [
    { key: "buy", count: d.buy },
    { key: "add", count: d.add },
    { key: "neutral", count: d.neutral },
    { key: "other", count: other },
  ];

  return raw
    .filter((s) => s.count > 0)
    .map((s) => ({
      key: s.key,
      label: SLICE_LABEL[s.key],
      count: s.count,
      pct: Math.round((s.count / total) * 100),
    }));
}

export type EpsOutlookItem = {
  year: string;
  eps: number;
  /** 相对上一年的隐含增速（%）。首年、或上一年基数 <= 0 时为 null——负基数的百分比没有意义。 */
  growthPct: number | null;
};

/** 逐年 EPS 一致预期（年份升序）+ 隐含增速。 */
export function epsOutlook(d: ConsensusDetail): EpsOutlookItem[] {
  const sorted = [...d.eps].sort((a, b) => a.year.localeCompare(b.year));
  return sorted.map((cur, i) => {
    const prev = i > 0 ? sorted[i - 1] : undefined;
    const growthPct =
      prev && prev.eps > 0
        ? Math.round(((cur.eps - prev.eps) / prev.eps) * 1000) / 10
        : null;
    return { year: cur.year, eps: cur.eps, growthPct };
  });
}
