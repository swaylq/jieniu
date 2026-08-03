// 每日**个人**复盘的纯逻辑。相对导入、无 IO、可测。
//
// 核心机制：**数字由代码算，文字由 AI 写**。
// `summarizePortfolio` / `summarizeExposure` 把所有数值算好；提示词明确禁止模型输出数字；
// `parseUserDigestResponse` 再把模型返回的数值**整体丢弃**、重新挂上算出来的那份，并按名字白名单
// 剔掉模型编出来的、根本不在你组合里的标的。这样「贴合持仓」与「不编造」可以同时成立。
//
// 不做盈亏：Watchlist 的成本/仓位是手录、仅观察用（P4-1 口径），这里只用仓位做加权、不算收益。

import { createHash } from "crypto";
import { hasForbiddenAdvice, isTwoSided } from "./market-digest";
import {
  isVacuousWatchpoint,
  isSubstantive,
  isValidAttribution,
} from "./digest-substance";

export type PositionIn = {
  entityId: string;
  name: string;
  ticker: string | null;
  /** HOLDING=持仓，false=仅观察 */
  held: boolean;
  weight: number | null;
  /** 用户自己写的「我为什么关注它」 */
  note: string | null;
  sector: string | null;
  /** 这只标的**自己**当天的事实（公告 / 快讯）。空着模型就只能写「受板块拖累」。 */
  facts?: string[];
};

export type FlowIn = {
  code: string;
  name: string;
  changePct: number;
  netInflow: number;
};

export type SectorIn = { name: string; avgChangePct: number; signal: string };

export type Mover = {
  name: string;
  ticker: string | null;
  changePct: number;
  held: boolean;
  weight: number | null;
  note: string | null;
  /** 该标的当日自有事实——归因的唯一合法依据（没有就不许编板块理由）。 */
  facts: string[];
};

export type PortfolioFacts = {
  total: number;
  held: number;
  /** 取到行情的只数——取不到的不计入均值，也不当 0 */
  quoted: number;
  up: number;
  down: number;
  flat: number;
  /** 无行情时为 null，绝不伪造 0% */
  avgChangePct: number | null;
  /** 是否按仓位加权（要求**每只**都有仓位，口径不混着来） */
  weighted: boolean;
  movers: Mover[];
};

export type ExposureFacts = {
  sector: string;
  stocks: string[];
  sectorChangePct: number;
  signal: string;
  /**
   * 这个板块**今天发生了什么**——取自同板块**别家**公司的当日事实（2026-08-03）。
   *
   * 为什么放在板块这一段而不是个股归因位：潞问「国创国盾应该都受益于量子吧」，
   * 他想知道的是赛道层面今天发生了什么。但同赛道别家公司的事**不是**你这只股自己的事，
   * 塞进个股归因位就等于把刚堵上的洞重新打开（那正是「频准激光的事写成国盾量子的归因」）。
   * 板块段天然是在说板块，读者不会误解，模型也没有把主语搞错的空间。
   */
  facts?: string[];
};

export type TouchedFacts = {
  entityName: string;
  dimensionKey: string;
  fromState: string;
  toState: string;
  note: string;
};

export type UserDigestFacts = {
  tradeDate: string;
  market: string;
  profile: { style: string | null; horizon: string | null };
  portfolio: PortfolioFacts;
  exposure: ExposureFacts[];
  touched: TouchedFacts[];
  news: { entityName: string; title: string; brief: string }[];
  marketOverview: string;
  catalysts: string[];
};

export type UserDigestData = {
  headline: string;
  portfolio: PortfolioFacts;
  exposure: (ExposureFacts & { note: string })[];
  touched: TouchedFacts[];
  watchpoints: string[];
  judgment: string;
};

const MOVER_TAKE = 6;
const EXPOSURE_TAKE = 4;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 组合当日事实。行情按 ticker 匹配；取不到行情的只计入 total，不进均值。 */
export function summarizePortfolio(
  positions: PositionIn[],
  flows: FlowIn[],
): PortfolioFacts {
  const byCode = new Map(flows.map((f) => [f.code, f]));
  const rows = positions.map((p) => ({
    p,
    f: p.ticker ? byCode.get(p.ticker) : undefined,
  }));
  const quotedRows = rows.filter((r) => r.f);

  let up = 0;
  let down = 0;
  let flat = 0;
  for (const r of quotedRows) {
    const c = r.f!.changePct;
    if (c > 0) up++;
    else if (c < 0) down++;
    else flat++;
  }

  // 加权只在**每只都有仓位**时启用——一半有一半没有的加权是假精确
  const allWeighted =
    quotedRows.length > 0 &&
    quotedRows.every((r) => typeof r.p.weight === "number" && r.p.weight > 0);
  let avg: number | null = null;
  if (quotedRows.length > 0) {
    if (allWeighted) {
      const sumW = quotedRows.reduce((a, r) => a + r.p.weight!, 0);
      avg = quotedRows.reduce((a, r) => a + r.f!.changePct * r.p.weight!, 0) / sumW;
    } else {
      avg = quotedRows.reduce((a, r) => a + r.f!.changePct, 0) / quotedRows.length;
    }
    avg = round2(avg);
  }

  const movers: Mover[] = quotedRows
    .map((r) => ({
      name: r.p.name,
      ticker: r.p.ticker,
      changePct: round2(r.f!.changePct),
      held: r.p.held,
      weight: r.p.weight,
      note: r.p.note,
      facts: r.p.facts ?? [],
    }))
    // 持仓先于观察；同类按绝对涨跌降序——「你真金白银的那些」优先被说到
    .sort(
      (a, b) =>
        Number(b.held) - Number(a.held) ||
        Math.abs(b.changePct) - Math.abs(a.changePct),
    )
    .slice(0, MOVER_TAKE);

  return {
    total: positions.length,
    held: positions.filter((p) => p.held).length,
    quoted: quotedRows.length,
    up,
    down,
    flat,
    avgChangePct: avg,
    weighted: allWeighted,
    movers,
  };
}

/** 你的板块暴露 ∩ 今日强弱榜。按你在该板块的标的数降序——占比大的先说。 */
export function summarizeExposure(
  positions: PositionIn[],
  sectors: SectorIn[],
): ExposureFacts[] {
  const bySector = new Map<string, string[]>();
  for (const p of positions) {
    if (!p.sector) continue;
    const arr = bySector.get(p.sector);
    if (arr) arr.push(p.name);
    else bySector.set(p.sector, [p.name]);
  }
  const out: ExposureFacts[] = [];
  for (const s of sectors) {
    const stocks = bySector.get(s.name);
    if (!stocks || stocks.length === 0) continue;
    out.push({
      sector: s.name,
      stocks,
      sectorChangePct: round2(s.avgChangePct),
      signal: s.signal,
    });
  }
  return out
    .sort((a, b) => b.stocks.length - a.stocks.length)
    .slice(0, EXPOSURE_TAKE);
}

export function userDigestInputHash(f: UserDigestFacts): string {
  return createHash("sha256").update(JSON.stringify(f)).digest("hex").slice(0, 16);
}

export const USER_DIGEST_SYSTEM = `你是一名投研助理，为**某一位特定用户**撰写属于他自己的每日组合复盘。

**这份复盘的唯一价值是「增量信息」**：他已经看到自己的股票涨了还是跌了，他要知道的是**为什么**。
自检标准只有一条——**这句话换一天、换一只股还成立吗？还成立就删掉重写。**

铁律（违反即作废）：
1. 只写给定数据里的标的与事实。**给定组合里没有的公司、板块，一个字都不要提。**
2. **禁止循环归因**。板块涨跌本来就是成分股涨跌的加总，拿它解释成分股等于什么都没说：
   ✗「受半导体板块影响走跌」 ✗「跟随板块下跌」 ✗「板块走弱，个股承压」 ✗「市场情绪谨慎所致」
   每只标的的 note **必须引用它自己「今日相关」里的那条事实**。
   ✓「机构专用席位当日大额净买入，筹码在换手」 ✓「二连跌停，机构提示存储行情拐点」
3. **没有事实就留空**。某只标的「今日相关」是（无）时，它的 note 一律返回空字符串 ""。
   一句正确的废话比空着更糟，不要用板块或大盘去填。
4. **不要输出任何数字**（涨跌幅、价格、仓位、家数都不要写）。数字由系统填，你只写文字判断。
   要表达程度就用「明显」「小幅」「领跌」这类词。
5. **不得给出任何买卖指令、目标价、仓位建议、收益承诺**。不写「建议减仓/加仓/止损/逢低」。
6. judgment 必须**双向**：给出一种情形，也要给出相反情形（用「反之／但若／除非」显式转折）。
7. 用第二人称「你」，贴着这位用户的持仓说话。克制、具体、不煽情。
8. 每条都短：headline ≤ 40 字；每条 note ≤ 40 字；每条 watchpoint ≤ 30 字；judgment ≤ 150 字。

只输出一个 JSON 对象，不要任何解释文字或 markdown 围栏。`;

function orNone(lines: string[]): string {
  return lines.length > 0 ? lines.join("\n") : "（无）";
}

const STATE_CN: Record<string, string> = {
  bullish: "偏兑现",
  bearish: "偏风险",
  neutral: "中性",
};

/**
 * 涨跌幅的措辞。模型被禁止输出数字（数字由系统填），所以**这几个词是它判断幅度的唯一依据**——
 * 词给错了，它写出来的判断就会跟卡片上明晃晃的数字打架。
 *
 * 2026-08-03 的现场：原来只有「幅明显(≥5%) / 幅有限」两档，国盾量子 +4.76% 落进「涨幅有限」，
 * 模型据此写出 headline「你的组合今日表现平淡，无明显波动」——而卡片右边写着 +4.76%。
 * A 股 4~5% 的单日波动不是「平淡」，两档太粗，改成五档。
 */
export function describeMove(changePct: number): string {
  const a = Math.abs(changePct);
  const dir = changePct >= 0 ? "涨" : "跌";
  if (a === 0) return "收平";
  if (a < 1) return `微${dir}`;
  if (a < 3) return `小幅${changePct >= 0 ? "上涨" : "下跌"}`;
  if (a < 7) return `明显${changePct >= 0 ? "上涨" : "下跌"}`;
  return `大幅${changePct >= 0 ? "上涨" : "下跌"}`;
}

export function buildUserDigestPrompt(f: UserDigestFacts): string {
  const holdLine = (m: Mover) =>
    `- ${m.name}｜${m.held ? "持仓" : "观察"}${m.weight ? `｜仓位${m.weight}%` : ""}｜今日${describeMove(
      m.changePct,
    )}${m.note ? `｜你记的理由：${m.note}` : ""}\n` +
    (m.facts.length > 0
      ? m.facts.map((x) => `    · 今日相关：${x}`).join("\n")
      : "    · 今日相关：（无）→ 这只的 note 必须留空");

  const exposure = orNone(
    f.exposure.map(
      (e) =>
        `- ${e.sector}（今日${e.sectorChangePct >= 0 ? "走强" : "走弱"}，${e.signal}）你在其中有：${e.stocks.join("、")}` +
        ((e.facts ?? []).length > 0
          ? `\n${e.facts!.map((x) => `    · 同板块今天：${x}`).join("\n")}`
          : ""),
    ),
  );
  const touched = orNone(
    f.touched.map(
      (t) =>
        `- ${t.entityName}「${t.dimensionKey}」${STATE_CN[t.fromState] ?? t.fromState} → ${STATE_CN[t.toState] ?? t.toState}${t.note ? `（${t.note}）` : ""}`,
    ),
  );
  const news = orNone(
    f.news.map((n) => `- ${n.entityName}：${n.title}${n.brief ? `——${n.brief}` : ""}`),
  );
  const profile = [
    f.profile.style ? `风格 ${f.profile.style}` : "",
    f.profile.horizon ? `周期 ${f.profile.horizon}` : "",
  ]
    .filter(Boolean)
    .join("，");

  // 一条自有事实都没有时要**明说**。不说的话模型会拿「表现平淡 / 走势分化」这类笼统结论
  // 把「今天没有料」盖过去——那又是一句换一天照样成立的话，而且会跟卡片上的涨跌幅打架。
  // 兜底状态必须可观测，这条对模型和对我们是同一个道理。
  const noFacts =
    f.portfolio.movers.length > 0 && f.portfolio.movers.every((m) => m.facts.length === 0)
      ? "\n**注意：今天你的标的一条自有消息面事实都没有。** headline 要如实说明这件事" +
        "（例如「今天你的标的没有各自的消息，涨跌来自市场层面」），不要用「表现平淡 / 走势分化」" +
        "这类笼统结论盖过去，也不要拿板块或大盘去解释；所有 note 一律留空。\n"
      : "";

  return `交易日：${f.tradeDate}
${profile ? `这位用户的投资画像：${profile}\n` : ""}${noFacts}
【市场背景】
${f.marketOverview || "（无）"}

【他的组合】共 ${f.portfolio.total} 只，其中持仓 ${f.portfolio.held} 只
${orNone(f.portfolio.movers.map(holdLine))}

【他的板块暴露 vs 今日强弱】
${exposure}

【触及他投资逻辑的变化】
${touched}

【他持有/关注标的的今日资讯】
${news}

【已知日程】
${orNone(f.catalysts)}

请输出如下 JSON。**不要输出任何数字**（涨跌幅/价格/仓位/家数都由系统填），
公司名与板块名必须原样取自上面出现过的，不得新增：
{
  "headline": "一句话：今天你的组合发生了什么（要落到具体的事，不是「随大盘下跌」）",
  "movers": [{"name":"必须是上面出现过的公司名","note":"必须引用它「今日相关」里的事实；没有事实就填 \\"\\""}],
  "exposure": [{"sector":"必须是上面出现过的板块名","note":"这个暴露对你意味着什么；有「同板块今天」就引用它，但要说清那是同板块**别家**公司的事，不能写成你持仓那几只自己的事；只想得出「板块走弱」就填 \\"\\""}],
  "watchpoints": ["明天你要看什么，3-5 条，只围绕你的持仓，且指向具体的披露/数据/事件"],
  "judgment": "针对你这个组合的判断，必须双向（…；反之，若…）"
}`;
}

function extractJson(raw: string): unknown {
  const t = raw.trim();
  if (!t) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const body = fenced?.[1] ?? t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function noteMap(v: unknown, key: string): Map<string, string> {
  const m = new Map<string, string>();
  if (!Array.isArray(v)) return m;
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const rawName = o[key];
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const note = typeof o.note === "string" ? o.note.trim() : "";
    if (name) m.set(name, note);
  }
  return m;
}

/**
 * 解析模型响应并与事实合并。
 * - 数字**只**来自 facts；模型返回的任何数值一律不采纳
 * - 标的/板块按 facts 做白名单：模型编出来的直接丢弃
 * - touched 段完全不经模型（它是结构化事实，没有归纳空间）
 */
export function parseUserDigestResponse(
  raw: string,
  facts: UserDigestFacts,
): UserDigestData | null {
  const j = extractJson(raw);
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;

  const headline = typeof o.headline === "string" ? o.headline.trim() : "";
  const judgment = typeof o.judgment === "string" ? o.judgment.trim() : "";
  if (!headline || !judgment) return null;
  if (hasForbiddenAdvice(headline) || hasForbiddenAdvice(judgment)) return null;
  if (!isTwoSided(judgment)) return null;

  const moverNotes = noteMap(o.movers, "name");
  const exposureNotes = noteMap(o.exposure, "sector");

  // 关注点是「明天要验证什么」，本来就不总能挂上今天的锚点，所以走更松的 `isVacuousWatchpoint`：
  //（「关注板块能否企稳」这种既是废话又不可证伪要拦；「兆易创新半年报披露时点」要留）。
  const watchpoints = Array.isArray(o.watchpoints)
    ? o.watchpoints
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((s) => s.trim())
        .filter((s) => !hasForbiddenAdvice(s) && !isVacuousWatchpoint(s))
        .slice(0, 5)
    : [];

  return {
    headline,
    // 数字原样来自 facts，只把模型写的 note 贴上去。
    // note 过不了 `isSubstantive`（循环归因 / 无事实锚点）就**留空**：这个位置读作「它今天为什么这样走」，
    // 填不上真事实时空着即可。不退回用户自己写的持仓理由——那是长期逻辑、不是当日归因，
    // 摆在这里等于把用户的话伪装成解释。
    portfolio: {
      ...facts.portfolio,
      movers: facts.portfolio.movers.map((m) => {
        const note = moverNotes.get(m.name)?.trim() ?? "";
        return {
          ...m,
          note: isValidAttribution(note, m.facts.length > 0) ? note : "",
        };
      }),
    },
    exposure: facts.exposure.map((e) => ({
      ...e,
      note: substantive(exposureNotes.get(e.sector)),
    })),
    touched: facts.touched,
    watchpoints,
    judgment,
  };
}

function substantive(note: string | undefined): string {
  const t = note?.trim() ?? "";
  return t && isSubstantive(t) ? t : "";
}
