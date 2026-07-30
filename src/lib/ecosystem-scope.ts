// 关系图谱的取数口径（sway 直报 ③：「关系这边很多公司都没有数据」）。
//
// 库里每家公司是 COMPANY / STOCK 一对孪生实体，而行业归属 `BELONGS_TO` 几乎只挂在 STOCK 那一份：
// 实测 `STOCK→SECTOR` 5356 条 vs `COMPANY→SECTOR` 181 条（后者是全市场扩容前那批老公司的遗留）。
// 于是 ecosystem 原来的两道查询各错一次：
//   1) 拿当前实体 id 直接查 BELONGS_TO —— 公司页 **60 抽 59 查空**，整个「关系」板块消失；
//   2) 板块成分限定 `from.type === "COMPANY"` —— 股票页 **60 抽 52** 板块出来了却一个同侪都没有。
// 这里把「我是谁」扩成「我的全部身份」（公司 + 它发行的股票），取板块、排除自己都按这组 id 走；
// 成分则两种类型都收，再按发行公司归并，免得同一家公司以孪生两份出现在同侪里。

export type PeerCandidate = {
  id: string;
  name: string;
  type: "COMPANY" | "STOCK";
  ticker: string | null;
  /** 该成分所属公司：STOCK 取其发行公司，COMPANY 就是自己。孤儿（查不到发行关系）为 null。 */
  companyId: string | null;
};

/** 当前实体的全部身份：自己 + 孪生实体。自己排第一，去重保序。 */
export function identityIds(selfId: string, twinIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [selfId, ...twinIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 两份身份都挂了同一个板块时（那 181 条老关系就会这样），板块列表要去重。 */
export function dedupeSectors<T extends { id: string }>(sectors: T[]): T[] {
  const seen = new Set<string>();
  return sectors.filter((s) => !seen.has(s.id) && (seen.add(s.id), true));
}

/**
 * 从板块成分里挑同侪：排除自己的全部身份 → 按发行公司归并（同一家只留一份，优先 COMPANY，
 * 因为搜索就是把股票归一到公司页的）→ 截断到 limit。孤儿股票（无发行公司）按自身 id 保留。
 */
export function selectPeersFrom(
  identity: string[],
  members: PeerCandidate[],
  limit = 8,
): PeerCandidate[] {
  const self = new Set(identity);
  const byCompany = new Map<string, PeerCandidate>();
  const order: string[] = [];

  for (const m of members) {
    if (self.has(m.id)) continue;
    if (m.companyId && self.has(m.companyId)) continue; // 自己的股票挂在别的 id 下也要排除
    const key = m.companyId ?? m.id;
    const kept = byCompany.get(key);
    if (!kept) {
      byCompany.set(key, m);
      order.push(key);
      continue;
    }
    // 同一家公司的两份身份都在成分里：留 COMPANY 那份
    if (kept.type !== "COMPANY" && m.type === "COMPANY") byCompany.set(key, m);
  }

  return order.slice(0, limit).map((k) => byCompany.get(k)!);
}
