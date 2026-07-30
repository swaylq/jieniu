import type { EntityType, RelationType } from "../../generated/prisma";

export type RelatedEntity = {
  id: string;
  name: string;
  type: EntityType;
  ticker?: string | null;
  /** 交易所前缀（SH/SZ/BJ…）。COMPANY 自己没有，页头要借配对股票那份来显示「SH 688826」。 */
  exchange?: string | null;
};
export type Direction = "out" | "in";
export type GraphRelation = {
  type: RelationType;
  direction: Direction;
  entity: RelatedEntity;
};

export type RelationBucket =
  | "sector"
  | "members"
  | "stocks"
  | "issuer"
  | "worksAt"
  | "people"
  | "related";

export const BUCKET_LABEL: Record<RelationBucket, string> = {
  sector: "所属板块",
  members: "板块成分",
  stocks: "股票",
  issuer: "发行公司",
  worksAt: "任职于",
  people: "相关人物",
  related: "相关",
};

export function bucketOf(type: RelationType, dir: Direction): RelationBucket {
  switch (type) {
    case "BELONGS_TO":
      return dir === "out" ? "sector" : "members";
    case "ISSUES":
      return dir === "out" ? "stocks" : "issuer";
    case "WORKS_AT":
      return dir === "out" ? "worksAt" : "people";
    case "RELATED":
      return "related";
  }
}

/**
 * 个股页/公司页要展示的行情 ticker：
 *  - STOCK 实体用自己的 ticker；
 *  - COMPANY 实体本身无 ticker，用它**发行**的股票（ISSUES-out，即 `stocks` 桶）的代码；
 *  - SECTOR / PERSON 无行情——尤其 SECTOR 的 `members` 桶里是成分股，绝不能拿某成员的行情
 *    当成板块行情（QA loop run 61 维度 h：旅游零售把成员 中国中免 的 P/E/市值 显示成板块估值）。
 */
export function resolveQuoteTicker(
  entity: { ticker: string | null },
  groups: Record<RelationBucket, RelatedEntity[]>,
): string | null {
  if (entity.ticker) return entity.ticker;
  // 只从「发行股票」桶(ISSUES-out，仅 COMPANY 有)取——不搜全部桶，否则 SECTOR 的 members 成分股
  // 会被当成板块行情。SECTOR/PERSON 的 stocks 桶为空 → 返 null（不显行情）。
  return groups.stocks.find((e) => e.ticker)?.ticker ?? null;
}

export function groupRelations(
  rels: GraphRelation[],
): Record<RelationBucket, RelatedEntity[]> {
  const groups: Record<RelationBucket, RelatedEntity[]> = {
    sector: [],
    members: [],
    stocks: [],
    issuer: [],
    worksAt: [],
    people: [],
    related: [],
  };
  for (const r of rels) groups[bucketOf(r.type, r.direction)].push(r.entity);
  return groups;
}
