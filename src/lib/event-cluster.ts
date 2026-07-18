// Event 合并纯逻辑（P4-7）：把同一事件的多篇报道聚成一簇。rule 预聚类，省 token（一簇一次 signal）。

/** 归一化：去标点/符号/空白、小写，保留 CJK + 字母数字。 */
export function normalizeForGrams(s: string): string {
  return s.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

/** 字符二元组（对中文标题的鲁棒相似度基础，无需分词）。 */
export function charBigrams(s: string): Set<string> {
  const t = normalizeForGrams(s);
  const g = new Set<string>();
  if (t.length <= 1) {
    if (t) g.add(t);
    return g;
  }
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function titleSimilarity(a: string, b: string): number {
  return jaccard(charBigrams(a), charBigrams(b));
}

/** 实体集合是否重叠（都为空视为「同属大盘/无实体」可比）。 */
export function entitiesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 && b.length === 0) return true;
  if (a.length === 0 || b.length === 0) return false;
  const sb = new Set(b);
  return a.some((x) => sb.has(x));
}

export type ClusterInput = {
  id: string;
  title: string;
  entityIds?: string[];
  publishedAt: Date | string;
};

export type NewsCluster = {
  memberIds: string[];
  representativeId: string;
  title: string;
  entityIds: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  count: number;
};

type Member = { id: string; title: string; grams: Set<string>; at: Date; entityIds: string[] };

/** 贪心聚类：同事件的多篇 = 实体重叠 + 标题相似度 ≥ 阈值 + 24h 窗内。按时间升序处理。 */
export function clusterNews(
  items: ClusterInput[],
  opts?: { threshold?: number; windowMs?: number },
): NewsCluster[] {
  const threshold = opts?.threshold ?? 0.5;
  const windowMs = opts?.windowMs ?? 24 * 60 * 60 * 1000;
  const sorted = [...items].sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );
  const clusters: {
    members: Member[];
    firstSeenAt: Date;
    lastSeenAt: Date;
  }[] = [];

  for (const it of sorted) {
    const at = new Date(it.publishedAt);
    const grams = charBigrams(it.title);
    const entityIds = it.entityIds ?? [];
    let placed = false;
    for (const c of clusters) {
      if (at.getTime() - c.lastSeenAt.getTime() > windowMs) continue;
      const ok = c.members.some(
        (m) =>
          entitiesOverlap(entityIds, m.entityIds) &&
          jaccard(grams, m.grams) >= threshold,
      );
      if (ok) {
        c.members.push({ id: it.id, title: it.title, grams, at, entityIds });
        if (at > c.lastSeenAt) c.lastSeenAt = at;
        if (at < c.firstSeenAt) c.firstSeenAt = at;
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        members: [{ id: it.id, title: it.title, grams, at, entityIds }],
        firstSeenAt: at,
        lastSeenAt: at,
      });
    }
  }

  return clusters.map((c) => {
    // 代表标题 = 与簇内其它标题最「居中」者（相似度之和最大），并列取最短。
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < c.members.length; i++) {
      let s = 0;
      for (let j = 0; j < c.members.length; j++) {
        if (i !== j) s += jaccard(c.members[i]!.grams, c.members[j]!.grams);
      }
      if (
        s > bestScore ||
        (s === bestScore && c.members[i]!.title.length < c.members[bestIdx]!.title.length)
      ) {
        bestScore = s;
        bestIdx = i;
      }
    }
    const rep = c.members[bestIdx]!;
    const entityIds = Array.from(new Set(c.members.flatMap((m) => m.entityIds)));
    return {
      memberIds: c.members.map((m) => m.id),
      representativeId: rep.id,
      title: rep.title,
      entityIds,
      firstSeenAt: c.firstSeenAt,
      lastSeenAt: c.lastSeenAt,
      count: c.members.length,
    };
  });
}
