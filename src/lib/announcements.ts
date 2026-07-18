// 个股「公告」折叠（产品质量循环 2026-07-15 run10）：一家公司一次定增/重组会**当天甩十几份程序性文档**
// （预案 + 风险提示 + 可行性分析 + 论证报告 + 保密措施 + 履行程序 + 关于本次交易符合《…》…），平铺在个股「公告」
// tab 会把这一个事件刷成十几条、淹没公司其它动态（实测仕佳光子 07-15 一天 19 条定增文档、精测电子 15 条重组文档）。
// 按「同日一手公告数」折叠：这信号与标题措辞无关（程序性预告标题五花八门，纯标题判事件会漏），最稳。

/** 程序性/合规样板公告标题——折叠时**不**选作代表（代表优先选实质公告：预案/停牌/业绩/中标…）。 */
const PROCEDURAL_TITLE =
  /符合《|不存在《|保密措施|保密制度|履行.{0,6}(法定)?程序|摊薄即期回报|前次募集资金使用情况|专门会议|书面审核意见|完备性|规范运作|真实性[、,]?准确性|独立性的?专项|所规定情形/;

/** 实质事件标题——优先选作代表，让折叠卡的头条能一眼看懂是什么事件（定增预案 / 停牌 / 业绩…）。 */
// 注意：用「权益分派/利润分配」等实打实的分配事件，不收裸「分红」——「未来三年股东分红回报规划」是定增预告文件、非头条。
const HEADLINE_TITLE =
  /预案|停牌|复牌|重大资产重组|发行股份.{0,6}购买|业绩预告|业绩快报|权益分派|利润分配|回购|要约收购|收购|中标|签[订约]|激励计划|问询函|立案|诉讼|仲裁|获批|减持计划|增持计划/;

/** 代表优先级：实质事件(0) < 中性(1) < 程序性样板(2)，越小越优先。 */
function titleRank(title: string): number {
  if (PROCEDURAL_TITLE.test(title)) return 2;
  if (HEADLINE_TITLE.test(title)) return 0;
  return 1;
}

export type BurstItem = {
  id: string;
  title: string;
  tier: string;
  importance: number;
  publishedAt: Date;
};

/** UTC 日期键。东财/巨潮同批公告 publishedAt 同日（多为当日 16:00），按日聚类稳。 */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 一批同日公告里挑代表：实质事件优先 → 高重要性 → 最新（程序性样板最后）。 */
function pickRepresentative<T extends BurstItem>(group: T[]): T {
  return [...group].sort((a, b) => {
    const ra = titleRank(a.title);
    const rb = titleRank(b.title);
    if (ra !== rb) return ra - rb;
    if (b.importance !== a.importance) return b.importance - a.importance;
    return b.publishedAt.getTime() - a.publishedAt.getTime();
  })[0]!;
}

/**
 * 折叠同日一手公告轰炸：同一天 ≥ threshold 条 PRIMARY 公告折成 1 条代表（见 pickRepresentative）+ `burstCount`＝当日其余份数。
 * 只折 PRIMARY（一手公告）；媒体资讯（非 PRIMARY）原样穿过、burstCount=0。**输入须按 publishedAt 倒序**，输出保序。
 * 代表落在当日簇的首位（最新那条的位置）。不足 threshold 的小簇全部保留。
 */
export function collapseAnnouncementBursts<T extends BurstItem>(
  items: T[],
  threshold = 4,
): (T & { burstCount: number })[] {
  const dayPrimaryCount = new Map<string, number>();
  for (const it of items) {
    if (it.tier === "PRIMARY") {
      const k = dayKey(it.publishedAt);
      dayPrimaryCount.set(k, (dayPrimaryCount.get(k) ?? 0) + 1);
    }
  }
  const emitted = new Set<string>();
  const out: (T & { burstCount: number })[] = [];
  for (const it of items) {
    if (it.tier !== "PRIMARY") {
      out.push({ ...it, burstCount: 0 });
      continue;
    }
    const k = dayKey(it.publishedAt);
    const n = dayPrimaryCount.get(k) ?? 0;
    if (n < threshold) {
      out.push({ ...it, burstCount: 0 });
      continue;
    }
    if (emitted.has(k)) continue; // 该日簇已用代表占位，跳过其余
    emitted.add(k);
    const dayItems = items.filter(
      (x) => x.tier === "PRIMARY" && dayKey(x.publishedAt) === k,
    );
    out.push({ ...pickRepresentative(dayItems), burstCount: n - 1 });
  }
  return out;
}
