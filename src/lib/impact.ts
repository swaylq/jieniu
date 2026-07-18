// Event 传播链纯逻辑（P4-9）：某持仓有异动时，经关系图扩散到用户其它持仓。
// 是「值得留意 / 自查」的关联提示，非因果断言、非荐股。amber/灰。

export type ImpactEdge = { fromId: string; toId: string; type: string };
export type ImpactPath = "peer" | "sector";
export type ImpactHit = { entityId: string; path: ImpactPath; relevance: number };

export const IMPACT_PATH_LABEL: Record<ImpactPath, string> = {
  peer: "竞品 / 关联",
  sector: "同板块",
};

/** 实体所属板块（BELONGS_TO 出边）。 */
function sectorsOf(entityId: string, edges: ImpactEdge[]): Set<string> {
  const s = new Set<string>();
  for (const e of edges) {
    if (e.type === "BELONGS_TO" && e.fromId === entityId) s.add(e.toId);
  }
  return s;
}

/** RELATED 邻居（无向）。 */
function peersOf(entityId: string, edges: ImpactEdge[]): Set<string> {
  const s = new Set<string>();
  for (const e of edges) {
    if (e.type !== "RELATED") continue;
    if (e.fromId === entityId) s.add(e.toId);
    else if (e.toId === entityId) s.add(e.fromId);
  }
  return s;
}

/** 源实体（有异动）→ 用户其它持仓的波及。源自身不计（已单独展示）。竞品关联(0.7) > 同板块(0.5)，去重取最高。 */
export function propagateImpact(
  sourceId: string,
  edges: ImpactEdge[],
  holdingIds: string[],
): ImpactHit[] {
  const srcSectors = sectorsOf(sourceId, edges);
  const srcPeers = peersOf(sourceId, edges);
  const hits: ImpactHit[] = [];
  for (const h of holdingIds) {
    if (h === sourceId) continue;
    if (srcPeers.has(h)) {
      hits.push({ entityId: h, path: "peer", relevance: 0.7 });
      continue;
    }
    const hSectors = sectorsOf(h, edges);
    let shares = false;
    for (const s of hSectors) {
      if (srcSectors.has(s)) {
        shares = true;
        break;
      }
    }
    if (shares) hits.push({ entityId: h, path: "sector", relevance: 0.5 });
  }
  hits.sort((a, b) => b.relevance - a.relevance || a.entityId.localeCompare(b.entityId));
  return hits;
}
