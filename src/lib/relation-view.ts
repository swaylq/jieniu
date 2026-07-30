// 「关系」tab 要展示什么（sway：关系里没有数字，也什么内容都没有）。
//
// 原来这个 tab 只铺 `entity.getById` 返回的**原始边**，而原始边少得可怜：
// 公司那份通常只有一条 `ISSUES → 它发行的股票`（实测三一重工 COMPANY 就只有这一条），
// 股票那份也只有「所属板块 + 发行公司」两条。点进去几乎是空的。
// 而真正有内容的「所属行业 + 同行竞品」一直只画在右栏，tab 里根本看不到。
//
// 这里把两边合成一个视图：板块用 ecosystem 的（它按「公司↔发行股票」两个身份一起查，
// 覆盖率 2.4% → 97%，见 lib/ecosystem-scope），竞品也用 ecosystem 的，其余原始边照旧展示。
// 计数取**去重后的关联对象总数**——tab 上那个数字就是「点进去能看到几个对象」。

import type { RelationBucket, RelatedEntity } from "./entity-graph";

export type EcosystemLike = {
  sectors: { id: string; name: string }[];
  peers: { id: string; name: string; ticker: string | null }[];
};

export type RelationSection = {
  key: string;
  label: string;
  items: { id: string; name: string }[];
};

/** 原始边里，已经被 ecosystem 更好地表达过的桶——不重复展示。 */
const SUPERSEDED: RelationBucket[] = ["sector", "members"];

/**
 * 合成「关系」tab 的分区与计数。
 * - 所属行业：取 ecosystem.sectors（比原始边全，公司那份也有）
 * - 同行竞品：取 ecosystem.peers
 * - 其余原始边（发行公司 / 股票 / 任职 / 相关人物 / 相关）原样保留
 * - total：以上所有对象按 id 去重后的个数
 */
export function ecosystemPeers(
  groups: Record<RelationBucket, RelatedEntity[]>,
  ecosystem: EcosystemLike,
  bucketLabel: Record<RelationBucket, string> = DEFAULT_LABELS,
): { sections: RelationSection[]; total: number } {
  const sections: RelationSection[] = [];
  if (ecosystem.sectors.length > 0) {
    sections.push({
      key: "sector",
      label: "所属行业",
      items: ecosystem.sectors.map((s) => ({ id: s.id, name: s.name })),
    });
  }
  if (ecosystem.peers.length > 0) {
    sections.push({
      key: "peers",
      label: "同行竞品",
      items: ecosystem.peers.map((p) => ({ id: p.id, name: p.name })),
    });
  }
  for (const bucket of Object.keys(groups) as RelationBucket[]) {
    if (SUPERSEDED.includes(bucket)) continue;
    const items = groups[bucket];
    if (!items || items.length === 0) continue;
    sections.push({
      key: bucket,
      label: bucketLabel[bucket],
      items: items.map((e) => ({ id: e.id, name: e.name })),
    });
  }
  const seen = new Set<string>();
  for (const s of sections) for (const i of s.items) seen.add(i.id);
  return { sections, total: seen.size };
}

const DEFAULT_LABELS: Record<RelationBucket, string> = {
  sector: "所属板块",
  members: "板块成分",
  stocks: "股票",
  issuer: "发行公司",
  worksAt: "任职于",
  people: "相关人物",
  related: "相关",
};
