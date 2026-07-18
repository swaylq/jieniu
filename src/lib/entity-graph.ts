import type { EntityType, RelationType } from "../../generated/prisma";

export type RelatedEntity = {
  id: string;
  name: string;
  type: EntityType;
  ticker?: string | null;
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
