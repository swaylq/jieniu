import crypto from "node:crypto";

import type { RawNewsItem, SourceDef } from "../types";
import { matchEntities, type EntityDictEntry } from "../../../lib/entity-tagging";

/**
 * 财联社电报（A 股时效最快的一手快讯流）。
 *
 * 2026-08-03 实测要点（改版后旧教程全失效，别照抄）：
 *  - 活端点是 `/v1/roll/get_roll_list`，旧的 `/nodeapi/telegraphList` 返 404 的 Next.js 壳；
 *  - 必须带 `sign`，算法 = `MD5(SHA1(参数按 key 字母序拼成 k=v&k=v))`，错了返
 *    `{"errno":"10012","msg":"签名错误"}`（HTTP 仍是 200——只看状态码会被骗）；
 *  - **`rn` 上限是 50**：rn=100/200 照返 `errno:0`，但 `roll_data` 是**空数组**。
 *    又一个「200 + 空」的静默失败，别把 rn 调大；
 *  - **翻页是死的**：`last_time` 不起作用，连翻 8 页拿回的是同一批 30 条。
 *    所以只能靠高频轮询覆盖——rn=50 覆盖约 2.5 小时，ingest 每 30 分钟一轮绰绰有余，
 *    但**间隔一旦拉长到 2 小时以上就会静默丢消息**（fetched 仍然是 50，看不出来）。
 */

const BASE = "https://www.cls.cn/v1/roll/get_roll_list";
const UA = "Mozilla/5.0 (jieniu-ingest)";

/** 财联社 web 端签名：参数按 key 字母序拼 query → SHA1 → MD5。 */
export function clsSign(params: Record<string, string>): string {
  const qs = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const sha1 = crypto.createHash("sha1").update(qs).digest("hex");
  return crypto.createHash("md5").update(sha1).digest("hex");
}

type ClsStock = { name?: string; StockID?: string };

type ClsRow = {
  id?: number | string;
  ctime?: number;
  title?: string;
  /** API 截断过的正文（约 60 字），别拿它当全文。 */
  content?: string;
  /** 完整正文——真正该入库的那份。 */
  brief?: string;
  level?: string;
  stock_list?: ClsStock[];
  subjects?: string[];
};

/**
 * 付费荐股引流体裁。
 *
 * 「【盘中宝】…这家企业拥有在手订单」「【电报解读】…这家公司已构建全产业链」——
 * 是财联社 VIP 的钩子：**刻意不点名公司**，正文在付费墙后。对解牛毫无信息量，
 * 而且体裁本身就是荐股，撞产品的合规红线（只做逻辑/影响面，禁买卖建议）。
 */
const CLS_PROMO = /^【(盘中宝|电报解读|风口|个股解析|VIP)/;

/** 「财联社8月3日电，」「《科创板日报》3日讯，」这类通稿前缀——做标题时剥掉。 */
const WIRE_PREFIX =
  /^(财联社|《科创板日报》|科创板日报|每日经济新闻|金十数据)[^，,]{0,12}[电讯]\s*[，,]\s*/;

// ---------------------------------------------------------------------------
// 噪音过滤
//
// `get_roll_list` 给的是**全频道**滚动流，`subscribedColumnIds` 参数是摆设（五个 id 返回
// 一模一样），源头筛不了。2026-08-03 对在库 27 条逐条肉眼复核，只有约 26% 对 A 股投资者
// 有价值，其余是海外行情碎讯、民生灾害、社会新闻。这些会以 30 分基线进首页「最新」
// （那条流是纯时间倒序、不看 importance），稳态下会占到两成，必须在入库前挡。
//
// 铁律：**标题里出现 A 股公司/股票 → 无条件保留**，宁可漏挡不可误杀。
// ---------------------------------------------------------------------------

/**
 * 海外市场标识。
 *
 * 行情类判据**必须**先命中它才生效——第一版只认「指数+涨跌」，结果把
 * 「收评：科创50指数低开低走跌超5%」（A 股收评）和「上海出口集装箱结算运价指数」
 * （国内宏观指标）一起误杀了。逐条肉眼复核才发现，正则测试全绿。
 * 恒生/港股刻意不列入：港股跟 A 股联动紧密，是有效素材。
 */
const FOREIGN_MARKET =
  /英国|美国|美股|德国|德指|法国|日本|日股|日经|韩国|韩股|印度|澳大利亚|澳洲|澳股|加拿大|巴西|墨西哥|菲律宾|越南|泰国|印尼|马来|新加坡|台湾|台交所|台股|台币|欧元区|欧洲|欧股|俄罗斯|土耳其|阿根廷|纳斯达克|纳指|道指|标普|富时|Tradegate/;

/**
 * 国内标识——命中它就一律不算海外，优先级高于 FOREIGN_MARKET。
 *
 * 「上海出口集装箱结算运价指数（**欧洲**航线）」是国内宏观指标，却因为「欧洲」二字
 * 被判成海外行情误杀。地名出现 ≠ 这条新闻属于那个市场。
 */
const DOMESTIC_MARKET =
  /上证|深证|沪深|沪指|深指|创业板|科创|北证|北交所|A股|两市|中国|上海|深圳|国内|境内|人民币|恒生|港股|南向|北向/;

/** 海外指数 / 国债行情碎讯：跟 A 股定价无关，且天天刷。 */
const FOREIGN_QUOTE =
  /(国债收益率|加权股价指数|综合指数|股价指数|股指|指数)[^，,。]{0,6}(收[涨跌高低]|上涨|下跌|涨|跌|报)/;
const FOREIGN_CORP_QUOTE =
  /(股价|股票)(在[^，,]{0,12}交易所)?[^，,]{0,4}(上涨|下跌|涨|跌)\s*[\d.]+\s*%|^[^，,]{0,14}(上市)?(能源|银行|保险|矿业|航空|汽车)?(公司|企业)?股价(上涨|下跌)[，,]/;
const FX_QUOTE =
  /(兑美元|兑欧元|兑日元|兑人民币|汇率)[^，,]{0,6}(上涨|下跌|涨|跌|报|升至|降至|跌至|涨至)/;

/** 民生 / 灾害 / 社会 / 时政花边——财经流里的纯噪音。 */
const CIVIC_NOISE =
  /(高温|暴雨|台风|寒潮|暴雪|冰雹|山洪|泥石流)(红色|橙色|黄色|蓝色)?预警|([\d.]+级|超大|特大|强烈)地震|海啸预警|开闸泄洪|抗生素超标|食品安全|市监局通报|狱中(发声|喊话)|涉嫌(违法|犯罪)被查/;

/** 海外公司的财报数字——没有 A 股关联时纯属背景噪音。 */
const FOREIGN_EARNINGS =
  /^[^，,]{0,12}(第[一二三四]季度|Q[1-4]|上半年|全年|[0-9]月)?[^，,]{0,8}(净利润|营收|营业收入|销售额|营业利润|全球销量)[^，,]{0,6}[\d,.]+\s*(亿|万)?\s*(日元|韩元|美元|欧元|英镑|辆)/;

/**
 * 零 A 股关联的海外并购。
 *
 * 真实案例：「普睿司曼与安科签署收购协议…交易完成后 Atkore 将退市」——`detectEventType`
 * 从「退市」抓到 45 分事件权重，叠加 MEDIA 的 10 分底，**拿了全场最高的 75 分**进重磅流。
 * 事件词典的语义是「A 股公司发生了什么」，套在海外交易上就是这个后果。
 */
const FOREIGN_MA = /(收购报价|收购协议|签署协议)[^。]{0,40}(美元|欧元|英镑)\s*\/?\s*股|将(被)?私有化退市/;

/** `foreignOnly` 的规则只在标题同时命中 FOREIGN_MARKET 时才生效。 */
const NOISE_RULES: { name: string; re: RegExp; foreignOnly?: boolean }[] = [
  { name: "海外指数/国债行情", re: FOREIGN_QUOTE, foreignOnly: true },
  // 不设 foreignOnly：「XX股价下跌7.8%」是外媒行情的措辞，A 股快讯说的是「XX涨停/涨超5%」。
  // 真有 A 股标的（「兆易创新股价下跌3.2%」）由标题护栏兜住，不会误杀。
  { name: "海外个股报价", re: FOREIGN_CORP_QUOTE },
  { name: "汇率报价", re: FX_QUOTE },
  { name: "民生/灾害/社会", re: CIVIC_NOISE },
  // 不设 foreignOnly：判据自带外币单位（日元/韩元/欧元…），已经蕴含海外语境，
  // 而「三菱日联」这类标题里恰恰没有「日本」这种国名词。
  { name: "海外公司财报数字", re: FOREIGN_EARNINGS },
  { name: "零 A 股关联的海外并购", re: FOREIGN_MA },
];

/**
 * 标题里是否真的提到了某只 A 股公司/股票。
 *
 * **只看标题，不看正文**——这是有代价换来的：财联社版「加州超大地震」正文里有
 * 「太平洋板块」（地质术语），撞上券商「太平洋(601099)」，于是这条灾害新闻拿到了
 * A 股绑定、绕过噪音过滤进了库。正文提及一个词跟这条新闻「关于」谁是两回事。
 */
function titleMentionsAStock(title: string, dict: EntityDictEntry[]): boolean {
  const ids = new Set(matchEntities(title, dict));
  return dict.some(
    (e) => ids.has(e.id) && (e.type === "COMPANY" || e.type === "STOCK"),
  );
}

/** 是否该按噪音丢弃。dict 为空时不过滤（保持纯解析语义）。 */
export function isClsNoise(title: string, dict: EntityDictEntry[]): boolean {
  if (dict.length === 0) return false;
  if (titleMentionsAStock(title, dict)) return false; // 护栏优先
  const isForeign =
    FOREIGN_MARKET.test(title) && !DOMESTIC_MARKET.test(title);
  return NOISE_RULES.some(
    (r) => (!r.foreignOnly || isForeign) && r.re.test(title),
  );
}

/** 财联社加红分级 → 重要性下限。实测 A/B 合计约一成，C 占九成。 */
function floorFromLevel(level?: string): number | undefined {
  if (level === "A") return 70;
  if (level === "B") return 60;
  return undefined;
}

/** 从正文取一个像标题的短句：优先【】里的整句，否则剥通稿前缀后取首句。 */
function titleFromBody(body: string): string {
  const bracket = /^【([^】]{2,120})】/.exec(body);
  if (bracket) return bracket[1]!.trim();
  const stripped = body.replace(WIRE_PREFIX, "");
  const firstSentence = stripped.split(/[。！？\n]/)[0] ?? "";
  return firstSentence.trim();
}

/**
 * 电报 → RawNewsItem。
 *
 * 关于 `stock_list`——**它不是「这条新闻关于哪家公司」**。字段长得很像权威个股归属
 * （给的是 `sh603986` 这种真代码 + 简称，不是东财快讯那种全是 ETF/指数的垃圾），
 * 但 2026-08-03 实测 50 条的扇出分布是 `{0:45, 6:1, 7:1, 8:3}`——**没有任何一条挂 1~2 只**。
 * 挂了股的那 5 条全是「主力资金监控」「涨跌停盘点」这类罗列式综述。
 * 也就是说这个字段的语义是「本条提到的股票」，不是「本条的主体」。
 *
 * 所以个股绑定仍然交给 runner 的文本匹配 + 综述判据，这里只在**扇出 ≤2** 时给 hints：
 * 是道防御性的门，实测从不触发，但万一财联社哪天给单股快讯挂上主体，它能接住；
 * 而扇出 6~8 的那些若给了 hints，会直接绑到 8 家公司头上污染自选早报。
 */
export function parseClsTelegraph(
  json: unknown,
  dict: EntityDictEntry[] = [],
): RawNewsItem[] {
  const rows =
    (json as { data?: { roll_data?: ClsRow[] } } | null)?.data?.roll_data ?? [];
  if (!Array.isArray(rows)) return [];

  const out: RawNewsItem[] = [];
  for (const r of rows) {
    const body = (r.brief ?? r.content ?? "").trim();
    const rawTitle = (r.title ?? "").trim();
    if (CLS_PROMO.test(rawTitle) || CLS_PROMO.test(body)) continue;

    const title = (rawTitle.length > 0 ? rawTitle : titleFromBody(body)).slice(
      0,
      120,
    );
    if (title.length === 0) continue;
    if (isClsNoise(title, dict)) continue;

    const id = String(r.id ?? "");
    if (id.length === 0) continue;

    const stocks = (r.stock_list ?? []).filter(
      (s) => (s?.name ?? "").trim().length > 0,
    );
    // 简称 + 纯代码（去掉 sh/sz 前缀）都给——resolveHints 按 name/shortName/ticker 精确匹配。
    const entityHints =
      stocks.length > 0 && stocks.length <= 2
        ? stocks.flatMap((s) => {
            const name = s.name!.trim();
            const code = /(\d{6})/.exec(s.StockID ?? "")?.[1];
            return code ? [name, code] : [name];
          })
        : undefined;

    out.push({
      externalId: id,
      title,
      url: `https://www.cls.cn/detail/${id}`,
      summary: body.slice(0, 500),
      content: body.length > 0 ? body : undefined,
      // ctime 是秒级 Unix 时间戳，无时区歧义。
      publishedAt: new Date((r.ctime ?? 0) * 1000),
      ...(entityHints ? { entityHints } : {}),
      ...(floorFromLevel(r.level) !== undefined
        ? { importanceFloor: floorFromLevel(r.level) }
        : {}),
    });
  }
  return out;
}

/** 财联社电报（媒体级一手快讯）。 */
export const clsTelegraph: SourceDef = {
  key: "cls-telegraph",
  name: "财联社电报",
  tier: "MEDIA",
  kind: "json-api",
  async fetch(dict): Promise<RawNewsItem[]> {
    const params: Record<string, string> = {
      app: "CailianpressWeb",
      os: "web",
      rn: "50", // 上限；调大只会拿到空数组
    };
    params.sign = clsSign(params);
    const res = await fetch(`${BASE}?${new URLSearchParams(params).toString()}`, {
      headers: { "User-Agent": UA, Referer: "https://www.cls.cn/" },
      signal: AbortSignal.timeout(15000), // 与 eastmoney-report-sweep 的 15s 一致
    });
    if (!res.ok) throw new Error(`cls-telegraph ${res.status}`);
    const json = (await res.json()) as { errno?: number | string };
    // 签名错/限流都是 HTTP 200 + errno≠0，必须显式判，否则静默返回 0 条。
    if (json.errno !== 0 && json.errno !== "0") {
      throw new Error(`cls-telegraph errno=${String(json.errno)}`);
    }
    return parseClsTelegraph(json, dict);
  },
};
