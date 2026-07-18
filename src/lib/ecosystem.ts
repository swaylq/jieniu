export type PeerCompany = { id: string; name: string; ticker: string | null };

/** 从"同板块成分公司"里选竞品：排除自己、去重、按给定顺序截断到 limit。 */
export function selectPeers(
  selfId: string,
  members: PeerCompany[],
  limit = 8,
): PeerCompany[] {
  const seen = new Set<string>([selfId]);
  const out: PeerCompany[] = [];
  for (const m of members) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}
