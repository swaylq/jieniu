import type { EntityType } from "../../generated/prisma";

export type EntityDictEntry = {
  id: string;
  type: EntityType;
  name: string;
  shortName?: string | null;
  aliases?: string[];
  ticker?: string | null;
};

const CJK = /[一-鿿]/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * CJK 词直接子串匹配；纯 ASCII / 数字（如 "IC"、股票代码）用词边界匹配，
 * 避免 "IC" 命中 "BASIC"、"688981" 命中 "2688981" 这类误配。
 */
export function containsToken(text: string, token: string): boolean {
  if (!token) return false;
  if (CJK.test(token)) return text.includes(token);
  const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
  return re.test(text);
}

/**
 * 公告/研报里高频出现、但与板块无关的样板词——匹配前先抹掉，避免把
 * "证券代码/证券交易所/开户银行" 之类样板文字误配成 券商/银行 板块。
 */
const BOILERPLATE = [
  "证券代码",
  "证券简称",
  "证券交易所",
  "证券登记",
  "证券监督",
  "证券投资",
  "证券事务",
  "证券期货",
  "债券代码",
  "债券简称",
  "公告编号",
  "开户银行",
  "银行账户",
  "银行存款",
  "存管银行",
  "托管银行",
  "监管银行",
  "结算银行",
  "募集资金专户",
  // 「中国银行间市场交易商协会」里裹着「中国银行」——实测中国银行 120 条绑定里有 17 条
  // 其实是别家公司「收到中国银行间市场交易商协会《接受注册通知书》」的公告（2026-07-23 质量审计）。
  // 必须排在「银行间市场」之前：正则按顺序取第一个匹配，先吃掉长的才不会剩下「中国银行」。
  "中国银行间市场交易商协会",
  "中国银行间市场",
  "银行间市场",
];
const BOILERPLATE_RE = new RegExp(BOILERPLATE.map(escapeRegExp).join("|"), "g");

/** 去掉公告样板词，降低板块误配。 */
export function stripBoilerplate(text: string): string {
  return text.replace(BOILERPLATE_RE, " ");
}

/**
 * 过于宽泛、单独出现会大量误配的裸词（"银行"命中德银/美国银行/开户银行，"证券"命中中泰证券/证券代码）。
 * 这些板块只允许通过限定别名（如 银行板块/银行股、证券板块）命中，不认裸词；
 * 具体公司(如"工商银行")是完整 token、不受影响。
 */
const AMBIGUOUS_BARE = new Set(["银行", "证券"]);

/** 实体名去掉尾部的代码括注：「机器人(300024)」→「机器人」。 */
function bareName(name: string): string {
  return name.replace(/[（(][^（()）]*[)）]\s*$/, "").trim();
}

/**
 * 公司名恰好就是一个板块/概念词时的消歧（2026-08-02 复盘）。
 *
 * 沈阳新松的证券简称就叫「机器人」，于是**每一条讲机器人行业的稿子**都绑到了它：
 * 近 7 天 532 条绑定里，标题提到它作为一家公司的是 **0 条**（「北京正全力打造机器人应用服务商模式」
 * 「机器狗量产大爆发」…）。它自己的页面因此被行业新闻淹没，而板块实体本来就已经收着这些稿子了。
 *
 * 判据不写死名单——**拿词典里的 SECTOR 名字当碰撞表**：公司/股票的名字撞上任何板块名，
 * 就不认裸名，必须有更强的线索：股票代码，或 A 股公告体裁的「简称:」「简称：」前缀
 * （「机器人:关于对外投资的公告」是它自己的公告，必须留住）。别名不受影响（「新松」照常命中）。
 */
export function needsDisambiguation(
  e: EntityDictEntry,
  sectorNames: Set<string>,
): boolean {
  return (
    (e.type === "COMPANY" || e.type === "STOCK") &&
    sectorNames.has(bareName(e.name))
  );
}

/** 撞名公司的强线索：代码命中，或标题**以**「简称:」开头（A 股公告体裁）。 */
function hasStrongCue(text: string, e: EntityDictEntry): boolean {
  const bare = bareName(e.name);
  if (e.ticker && containsToken(text, e.ticker)) return true;
  // 必须锚在开头：只写 includes 会让「珞石机器人：预计上半年收入…」也算数——
  // 那是另一家公司，「机器人：」只是它名字的尾巴（实测 3 条保留里 2 条是这个）。
  if (new RegExp(`^${escapeRegExp(bare)}[：:]`).test(text.trim())) return true;
  const extra = [e.shortName ?? "", ...(e.aliases ?? [])].filter(
    (t) => t && t !== bare && !AMBIGUOUS_BARE.has(t),
  );
  return extra.some((t) => containsToken(text, t));
}

/** 返回文本中提及到的实体 id（去重，按词典顺序）。匹配前先去样板词；宽泛裸词只走限定别名。 */
export function matchEntities(rawText: string, dict: EntityDictEntry[]): string[] {
  const text = stripBoilerplate(rawText);
  const sectorNames = new Set(
    dict.filter((e) => e.type === "SECTOR").map((e) => bareName(e.name)),
  );
  const matched: string[] = [];
  for (const e of dict) {
    if (needsDisambiguation(e, sectorNames)) {
      if (hasStrongCue(text, e)) matched.push(e.id);
      continue;
    }
    const tokens = [
      e.name,
      e.shortName ?? "",
      ...(e.aliases ?? []),
      e.ticker ?? "",
    ].filter((t) => t && !AMBIGUOUS_BARE.has(t));
    if (tokens.some((t) => containsToken(text, t))) {
      matched.push(e.id);
    }
  }
  return matched;
}

/**
 * 标注结果里是否含至少一个 COMPANY / STOCK 实体。
 * 官方公告(official-filing)是公司专属体裁——只绑到 SECTOR（正文里恰好出现板块名的误绑）或纯未绑定，
 * 都说明这条公告的主体不在本产品「聚焦热门标的」的覆盖范围内。入库端与存量清理共用此判定。
 */
export function hasCoveredEntity(
  entityIds: string[],
  dictById: Map<string, EntityDictEntry>,
): boolean {
  return entityIds.some((id) => {
    const t = dictById.get(id)?.type;
    return t === "COMPANY" || t === "STOCK";
  });
}

/**
 * 把 fetcher 已知的实体线索（公司名/简称/股票代码，精确匹配）解析成实体 id。
 * 用于来源本身就带权威归属的场景（如巨潮公告的 secName/secCode）。
 */
export function resolveHints(
  hints: string[] | undefined,
  dict: EntityDictEntry[],
): string[] {
  if (!hints || hints.length === 0) return [];
  const wanted = new Set(hints.map((h) => h.toLowerCase()));
  const ids: string[] = [];
  for (const e of dict) {
    const keys = [e.name, e.shortName ?? "", e.ticker ?? ""]
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    if (keys.some((k) => wanted.has(k))) ids.push(e.id);
  }
  return ids;
}
