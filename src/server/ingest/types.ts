import type { SourceTier } from "../../../generated/prisma";
import type { EntityDictEntry } from "../../lib/entity-tagging";

/** 一个源抓取归一化后的单条新闻。 */
export type RawNewsItem = {
  externalId?: string;
  title: string;
  url: string;
  summary: string;
  content?: string;
  publishedAt: Date;
  eventType?: string | null;
  /** fetcher 已知的权威实体归属（公司名/股票代码等），供 resolveHints 精确挂载。 */
  entityHints?: string[];
};

/** 一个数据源的定义 + 抓取方法（拿到实体词典以便按代码定向抓取）。 */
export type SourceDef = {
  key: string;
  name: string;
  tier: SourceTier;
  kind: string;
  /**
   * 该体裁「主体唯一且源已给出」——只按 entityHints 挂载，不做标题文本匹配。
   *
   * 券商研报就是这样：一篇《世界汽车玻璃龙头，智能化助推ASP提升》讲的是福耀玻璃，
   * 标题里的「汽车」却会被词典匹配成板块，于是研报绑到了汽车板块上。实测 1,123 篇研报
   * 被这样绑到板块，半导体/人工智能这些热门板块页会被上百篇个股研报刷屏。
   * 打开此开关后，研报只绑它的标的公司与股票。
   */
  subjectOnly?: boolean;
  fetch: (dict: EntityDictEntry[]) => Promise<RawNewsItem[]>;
};
