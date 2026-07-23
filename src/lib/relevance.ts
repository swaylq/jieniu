// 综述 / 榜单 / ETF 营销类资讯识别（产品质量循环 2026-07-15）。
//
// 市场收评、涨跌停潮、大宗交易、龙虎榜、基金二季报、ETF 营销等文章会在标题/摘要里
// 顺带罗列多只个股，matchEntities 会把它们绑到每一只——污染「你的自选股」早报与个股页
// （例：「港股开盘：恒生指数高开」被绑到 兆易创新/长飞光纤；「多只翻倍基二季报出炉」绑 11 只）。
// 这类文章不是「关于」某只个股的，应只保留板块(SECTOR)归属，不绑 COMPANY/STOCK/PERSON。

/**
 * 「市场综述 / 榜单 / 大盘」标题特征。
 * 只收几乎只出现在综述里的词（收评/涨停潮/大盘/指数名…），刻意**不**收裸「开盘/收盘」——
 * 「领益智造开盘涨停」是真·个股新闻，绑到个股才对；综述靠「恒生指数/沪指/收评」等区分。
 */
export const ROUNDUP_TITLE =
  /收评|午评|早评|复盘|涨停潮|跌停潮|涨停榜|跌停榜|\d+只股|附股[)）]|大宗交易|龙虎榜|资金流[向入出]|北向资金|主力(资金|净[流买])|多只|多家个股|密集(发布|亮相|预告|披露|现身)|集体(大涨|大跌|调整|异动|走强|走弱)|涨幅榜|跌幅榜|(基金|公募).{0,4}(二季报|三季报|一季报)|基金经理|翻倍基|盘前(情报|必读|播报)|十大券商|券商策略|研报.{0,8}一览|盈利预测一览|(下调|上调)\d+家|大盘|沪指|深指|创业板指|科创50|沪深300|三大指数|恒生(指数|科技)|中概股/;

/** ETF 营销类标题（ETF + 括注基金代码，如「机床ETF华夏(159663)日均成交1.25亿」）——纯基金推广，非公司资讯，入库时直接丢弃。 */
export const ETF_MARKETING_TITLE = /ETF[^，。！？]{0,14}[（(]\d{5,6}[)）]/;

/**
 * 是否为「顺带罗列多只个股」的综述/榜单——true 则不应绑到个股（只留板块）。
 * 判据：命中综述标题词，或扇出到 ≥8 个实体（真正「关于」某事的新闻极少同时讲 8 只个股）。
 */
export function isRoundupNews(title: string, boundCount: number): boolean {
  return ROUNDUP_TITLE.test(title) || boundCount >= 8;
}

/** 是否为 ETF 营销类垃圾资讯（入库前剔除）。 */
export function isEtfMarketing(title: string): boolean {
  return ETF_MARKETING_TITLE.test(title);
}

// 保荐机构/中介绑定污染（产品质量循环 2026-07-15 run2）。
// 券商(中信证券等)作被保荐公司的「保荐机构 / 核查方 / 持续督导方」，其全名会出现在
// 被保荐公司的公告标题里（「航材股份:中信证券…关于…核查意见」）——matchEntities 便把公告绑到
// 券商，导致券商自己的 feed 被别家公司的募投/IPO/核查公告刷屏（实测中信证券近 30 天 115 条里 56 条如此）。
// 这类公告的「主体」是被保荐公司，券商只是中介，不应绑到券商。

/**
 * 只收「几乎只在 券商作中介 的公告标题里出现」的措辞——刻意**不**收裸「保荐/承销」
 * （「中信证券保荐业务收入增长」是真·券商自身新闻）。命中即：标题里的中介方是保荐/督导方、非被报道主体。
 */
export const INTERMEDIARY_ROLE =
  /核查意见|持续督导|独立财务顾问|保荐机构|保荐代表人|保荐人|发行保荐书|上市保荐书|辅导(工作总结|报告|备案|验收|进展|首期|天团|团队)|尽职调查报告|受托管理事务报告|专项核查/;

/** 名字即可判定为金融中介的实体（券商/会计所/律所/评估）。无「证券」字样者(中金公司/东方财富/国泰海通)靠 券商板块 BELONGS_TO 另行补齐。 */
export const INTERMEDIARY_NAME = /证券$|证券公司$|会计师事务所|律师事务所|资产评估/;

/** 标题是否为「券商作保荐/核查中介」的公告（主体是被保荐公司，非券商本身）。 */
export function isIntermediaryRole(title: string): boolean {
  return INTERMEDIARY_ROLE.test(title);
}

/** 实体名是否可判定为金融中介（券商/事务所/评估）。 */
export function isIntermediaryName(name: string): boolean {
  return INTERMEDIARY_NAME.test(name);
}

// 研报观点体裁归属（产品质量循环 2026-07-15 run3）。
// 「中信证券：继续全面看好国产算力产业链」这类「机构：观点」体裁，观点主体是被点评的
// 行业/标的（算力/半导体…），机构只是发声者——却被绑到机构自身，污染券商 feed
// （实测中信建投 feed 70%、华泰 64%、中信证券 49% 是这类本机构研报观点）。
// 应从「发声机构自身」剪掉绑定（被点评的板块/标的绑定保留）。
//
// 例外：「中信证券：预计上半年净利润同比增长69.59%」是机构**自身业绩/公司事件**，必须保留。
// 权衡取「宁可少剪、不可误杀自身新闻」：自身事件关键词从宽，漏剪几条观点无妨，绝不剪掉自身业绩。

/** 机构「自身公司事件」关键词——命中则是机构自己的业绩/治理/交易类新闻，不作观点处理、保留绑定。 */
export const OWN_CORP_EVENT =
  /净利润|净利|业绩|营收|营业收入|营业总收入|毛利|分红|派息|回购|增持|减持|举牌|股东大会|控股股东|股权|定增|配股|可转债|发债|债券|董事|监事|高管|人事|中标|签约|收购|并购|重组|停牌|复牌|处罚|处分|立案|问询函|关注函|诉讼|仲裁|获批|牌照|资质|评级(上调|下调|调整|展望)|上市|退市|解禁|质押/;

/**
 * 标题是否为「机构对外研报观点」（应从该机构自身剪掉绑定）。
 * 判据：标题以「机构名：」开头，且**不**含机构自身公司事件关键词。
 */
export function isInstitutionOpinionAboutOthers(
  title: string,
  institutionName: string,
): boolean {
  const prefixed =
    title.startsWith(`${institutionName}：`) ||
    title.startsWith(`${institutionName}:`);
  if (!prefixed) return false;
  return !OWN_CORP_EVENT.test(title);
}

/**
 * 标题是否带「（发布机构）」后缀——解牛收录券商研报时自己加的机构后缀
 * （见 sources/eastmoney-report.ts：加后缀是为了让不同券商同日的同名研报不被判重并掉）。
 *
 * 与上面的前缀判据分开写、且**不**走 OWN_CORP_EVENT 例外：后缀里的机构是解牛写进去的
 * 发布者，身份确定无疑，绝不是研报主体。不剪的话券商 feed 会被自家研报再次淹没（run3 旧疾）。
 */
export function isReportPublisherSuffix(
  title: string,
  institutionName: string,
): boolean {
  return title.endsWith(`（${institutionName}）`);
}

/**
 * 同上，但比对实体的**全部叫法**（name / 去掉「(代码)」后缀的 name / shortName / 别名）。
 *
 * 实测（6699 篇研报体检）：只比 `name` 会漏——实体名存作「第一创业(002797)」，
 * 研报后缀写的是「（第一创业）」，对不上，那篇研报就绑到了发布机构自己。
 */
export function isReportPublisherOf(
  title: string,
  entity: { name: string; shortName?: string | null; aliases?: string[] },
): boolean {
  const names = [
    entity.name,
    entity.name.replace(/[（(][^）)]*[）)]\s*$/, ""),
    entity.shortName ?? "",
    ...(entity.aliases ?? []),
  ].filter((n) => n.length > 0);
  return names.some((n) => isReportPublisherSuffix(title, n));
}

// 纯程序性/样板公告 & 海外行情碎讯（产品质量循环 2026-07-15 run5·数据质量）。
// 巨潮公告里大量「法律意见书 / 公司章程 / 会计师鉴证报告 / 市值管理制度 / H股通函」——标题只是
// 文件类型或治理文书、无实质投资信息，堆在个股「公告」页是噪声（近 7 天入库 49% 无实体绑定）。
// 刻意**不**收 回购/减资/澄清/增减持/业绩/中标/重组 等有实质信息的公告。

// 注意：**不**收「法律意见书/律师工作报告」——实测大量是「关于差异化分红/股权激励/回购…的法律意见书」，
// 这些法律意见的主体是分红/回购/激励等**有实质信息**的事件，误杀会丢信号。只收纯治理/文件类模板。
export const BOILERPLATE_FILING =
  /公司章程|章程(修订|修正|草案)|会计师(事务所)?.{0,12}鉴证报告|鉴证报告$|内部控制(评价|审计)报告|.{0,8}管理制度$|.{0,8}管理办法$|独立董事.{0,12}述职报告|募集资金(存放|三方监管协议)|H股(公告|通函|市场公告)|翌日披露報表|持续督导(年度|跟踪|现场检查)/;

/** 是否为纯程序性/样板公告（入库跳过 / 存量解绑，清个股「公告」页噪声）。 */
export function isBoilerplateFiling(title: string): boolean {
  return BOILERPLATE_FILING.test(title);
}

// 海外市场盘面碎讯：解牛是 A 股私人投研 agent，「美股/纳指/日韩/中概股 涨跌开盘」这类非 A 股、
// 多为 0 绑定的盘面 tick 是噪声。只拦「海外市场词开头 + 涨跌/开盘类结尾」的短碎讯，
// 不误伤「英伟达发布财报」这类有实质的海外资讯。
export const FOREIGN_MARKET_NOISE =
  /^(美股|纳指|道指|标普|纳斯达克|日经|韩股|欧股|富时|德指|日韩股市|中概股).{0,10}(高开|低开|高走|低走|转涨|转跌|涨幅扩大|跌幅扩大|收涨|收跌|大涨|大跌|普涨|普跌|走高|走低|震荡|盘整)$/;

/** 是否为海外市场盘面碎讯（非 A 股、低价值，入库跳过）。 */
export function isForeignMarketNoise(title: string): boolean {
  return FOREIGN_MARKET_NOISE.test(title);
}

// 海外投行/银行「自家事务」碎讯（run6·数据质量）：如「摩根士丹利第二季度净营收…」「花旗预计Q4铜价…」
// 「美国银行给OpenAI信贷额度」——这类海外金融机构谈自家业绩/大宗商品/海外央行的资讯，与 A 股无关。
// **只**收海外投行/银行名（不含 Meta/特斯拉/英伟达/台积电等供应链相关科技/制造名，避免误杀 A 股产业链信号），
// 且在 runner 里**仅当该资讯 0 绑定任何 A 股实体时**才丢弃——「高盛恢复跟踪宁德时代A股」有绑定，保留。
export const FOREIGN_FINANCIAL =
  /摩根士丹利|摩根大通|高盛|花旗|富国银行|美国银行|贝莱德|蒙特利尔银行|瑞银|巴克莱|德意志银行|汇丰控股|渣打集团|杰富瑞|Capital\s?Power/;

/** 标题是否提及海外投行/银行（配合 runner 的「0 绑定 A 股实体」门槛使用）。 */
export function isForeignFinancialNoise(title: string): boolean {
  return FOREIGN_FINANCIAL.test(title);
}
