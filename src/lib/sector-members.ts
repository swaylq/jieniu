// 板块成员去重（QA loop run2）：行业分类挂 STOCK、主题分类挂 COMPANY——同一家公司可能两者都在
// 同一板块（如半导体的 中芯国际(688981) 与 中芯国际），「N 只」不能重复计数。按「公司名」(股票名
// 去掉 (代码) 后缀 = 公司名) 合并，留 STOCK 作代表（可链到个股页），热度相加。

export type SectorMember = { id: string; name: string; type: string; heat: number };

/** 公司名 = 股票名去掉尾部 (代码)；COMPANY 名本身即公司名。 */
function firmKey(name: string): string {
  return name.replace(/\(.*\)$/, "").trim();
}

/**
 * 把一个板块的成员（STOCK 与 COMPANY 混合）去重成「一家公司一条」，STOCK 优先作代表，
 * 热度相加，按热度降序返回。用于 allSectors 的 memberCount / top（准确的「N 只」）。
 */
export function dedupeSectorMembers(
  members: SectorMember[],
): { id: string; name: string; heat: number }[] {
  const byFirm = new Map<string, { rep: SectorMember; heat: number }>();
  for (const m of members) {
    const key = firmKey(m.name);
    const prev = byFirm.get(key);
    if (!prev) {
      byFirm.set(key, { rep: m, heat: m.heat });
    } else {
      prev.heat += m.heat;
      // STOCK 优先作代表（能链到个股页）；已是 STOCK 则不换。
      if (prev.rep.type !== "STOCK" && m.type === "STOCK") prev.rep = m;
    }
  }
  return [...byFirm.values()]
    .map((v) => ({ id: v.rep.id, name: v.rep.name, heat: v.heat }))
    .sort((a, b) => b.heat - a.heat);
}
