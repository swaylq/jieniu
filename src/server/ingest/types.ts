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
  fetch: (dict: EntityDictEntry[]) => Promise<RawNewsItem[]>;
};
