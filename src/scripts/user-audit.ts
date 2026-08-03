// 用户呈现数据复盘（2026-08-02 起，每日定时跑）。
//
// 回答一个问题：**今天每个真实用户打开解牛，看到的是什么**——以及这中间有哪些是坏的。
// 纯只读、零 AI、可重复跑。判断留给读报告的人（cron 里是一个 Claude 回合），
// 脚本只负责把事实和阈值摆出来：`⚠` 开头的行是需要动手的，没有 `⚠` 就是今天没事。
//
// 为什么要有这个脚本：8-02 那轮体检是手搓一次性探针跑出来的，
// 结论很值钱（供给排序不认用户、逻辑异动链路没排期、撞板块名磁石），
// 但下一次还要从头写一遍。固化成脚本后，每天的成本只剩「读报告 + 判断」。
//
// 用法：DATABASE_URL=... SKIP_ENV_VALIDATION=1 npx tsx src/scripts/user-audit.ts

import { PrismaClient } from "../../generated/prisma";
import { rollUpHoldingChange } from "../lib/portfolio-change";
import { briefingStats } from "../lib/briefing";
import { upcomingCatalysts, type CatalystRow } from "../lib/catalyst-window";
import { parseAppointmentView } from "../lib/disclosure";

const db = new PrismaClient();

/**
 * 告警阈值。改这里等于改「什么算不正常」——每条都要有实测依据，别拍脑袋。
 *
 * 2026-08-03 首次实跑，四条告警里三条是**判据自己错**（把正常状态报成异常）：
 * 复盘拿「今天」比（而它 15:40 才生成）、埋点拿「7 天」比（含改动前的存量）、
 * 资讯陈旧拿 publishedAt 比（小盘股本来就没有新料）。定时报告最怕天天喊狼来了，
 * 所以每条判据都要能回答「这是坏了，还是本来就长这样」。
 */
const T = {
  /**
   * 「多久没去抓过」的上限——判据是入库时刻 createdAt，不是新闻发布时刻。
   * 实测：王子新材最新发布停在 7-13，但 8-03 04:55 刚抓过 18 条——是这只股没新料，
   * 不是管线没跑。用 publishedAt 判会把所有小盘股天天报成异常。
   */
  staleFetchDays: 2,
  /** 个人复盘覆盖率下限（有自选的用户里拿到复盘的比例）。 */
  digestCoverage: 0.8,
  /** 提醒已读率下限。停留 2.5 秒自动标已读上线后，来过的人应该都被标上。 */
  alertReadRate: 0.5,
  /** 真实用户埋点占比下限——低于此说明爬虫又在灌库。 */
  analyticsRealRate: 0.5,
  /** 「空屏用户」占比上限：四卡全 0 且没有静默日兜底可显示的。 */
  emptyScreenRate: 0.2,
};

const DAY = 86400000;
const now = new Date();
const d7 = new Date(now.getTime() - 7 * DAY);
const d30 = new Date(now.getTime() - 30 * DAY);
const alerts: string[] = [];

function warn(msg: string) {
  alerts.push(msg);
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  console.log(`# 用户呈现数据复盘 · ${localDay(now)} ${now.toTimeString().slice(0, 5)}\n`);

  const users = await db.user.findMany({
    select: { id: true, email: true, phone: true, alertEmail: true },
  });
  const wlAll = await db.watchlist.findMany({
    where: { status: { not: "CLOSED" } },
    select: {
      userId: true,
      entityId: true,
      status: true,
      entity: {
        select: {
          name: true,
          ticker: true,
          relFrom: {
            where: { type: "ISSUES" as const },
            select: { toId: true },
            take: 1,
          },
        },
      },
    },
  });
  const byUser = new Map<string, typeof wlAll>();
  for (const w of wlAll) {
    const a = byUser.get(w.userId) ?? [];
    a.push(w);
    byUser.set(w.userId, a);
  }

  const allIds = [...new Set(wlAll.flatMap((w) => [w.entityId, ...w.entity.relFrom.map((r) => r.toId)]))];
  const [sig7, esigs, lastNews, digestsToday, alertRows] = await Promise.all([
    db.thesisSignal.findMany({
      where: { entityId: { in: allIds }, publishedAt: { gte: d7 } },
      select: { entityId: true, dimensionKey: true, direction: true, materiality: true, note: true },
    }),
    db.entitySignal.findMany({
      where: { entityId: { in: allIds } },
      select: { entityId: true, kind: true, detail: true },
    }),
    db.$queryRaw<{ entityId: string; last: Date | null; fetched: Date | null }[]>`
      SELECT ne."entityId", MAX(n."publishedAt") AS last, MAX(n."createdAt") AS fetched
      FROM "NewsEntity" ne JOIN "NewsItem" n ON n.id = ne."newsId"
      WHERE ne."entityId" = ANY(${allIds}) GROUP BY ne."entityId"`,
    db.userDigest.findMany({ where: { tradeDate: localDay(now) }, select: { userId: true } }),
    db.alertEvent.findMany({
      where: { occurredAt: { gte: d30 } },
      select: { userId: true, kind: true, priority: true, readAt: true, emailedAt: true, title: true, occurredAt: true },
    }),
  ]);

  const sigBy = new Map<string, typeof sig7>();
  for (const s of sig7) {
    const a = sigBy.get(s.entityId) ?? [];
    a.push(s);
    sigBy.set(s.entityId, a);
  }
  const lastBy = new Map(lastNews.map((r) => [r.entityId, r.last]));
  const fetchedBy = new Map(lastNews.map((r) => [r.entityId, r.fetched]));
  const discBy = new Map<string, unknown>();
  const kindsBy = new Map<string, Set<string>>();
  for (const e of esigs) {
    if (e.kind === "disclosure") discBy.set(e.entityId, e.detail);
    const s = kindsBy.get(e.entityId) ?? new Set<string>();
    s.add(e.kind);
    kindsBy.set(e.entityId, s);
  }
  const digestUsers = new Set(digestsToday.map((d) => d.userId));

  // ---------- 逐个用户 ----------
  let emptyScreen = 0;
  let activeUsers = 0;
  for (const u of users) {
    const wl = byUser.get(u.id) ?? [];
    if (wl.length === 0) continue;
    activeUsers++;
    const tag = u.email?.split("@")[0] ?? (u.phone ? `phone:${u.phone.slice(0, 3)}***` : u.id.slice(0, 6));
    const items = wl.map((w) =>
      rollUpHoldingChange(
        w.entityId,
        w.entity.name,
        [...(sigBy.get(w.entityId) ?? []), ...w.entity.relFrom.flatMap((r) => sigBy.get(r.toId) ?? [])],
        w.status === "HOLDING" ? "HOLDING" : "WATCH",
      ),
    );
    const st = briefingStats(items);
    const cands: CatalystRow[] = [];
    for (const w of wl) {
      const d = [w.entityId, ...w.entity.relFrom.map((r) => r.toId)].map((i) => discBy.get(i)).find((x) => x !== undefined);
      const v = parseAppointmentView(d);
      if (v) cands.push({ entityId: w.entityId, name: w.entity.name, periodLabel: v.periodLabel, date: v.date });
    }
    const cats = upcomingCatalysts(cands);
    // 静默日兜底能不能显示（没有它，四卡全 0 就是真空屏）
    const hasQuietFacts = wl.some((w) =>
      [w.entityId, ...w.entity.relFrom.map((r) => r.toId)].some((id) =>
        [...(kindsBy.get(id) ?? [])].some((k) => k !== "disclosure"),
      ),
    );
    const empty = st.noticeable === 0 && cats.length === 0 && !hasQuietFacts;
    if (empty) emptyScreen++;

    const stalest = wl
      .map((w) => {
        const last = [w.entityId, ...w.entity.relFrom.map((r) => r.toId)]
          .map((i) => lastBy.get(i))
          .filter((x): x is Date => !!x)
          .sort((a, b) => +b - +a)[0];
        return { name: w.entity.name, days: last ? Math.floor((+now - +last) / DAY) : 999 };
      })
      .sort((a, b) => b.days - a.days)[0];

    console.log(
      `## ${tag}  自选 ${wl.length}（持仓 ${wl.filter((w) => w.status === "HOLDING").length}）` +
        `　四卡 ${st.review}/${st.strengthened}/${st.muted}/${cats.length}` +
        `　复盘 ${digestUsers.has(u.id) ? "✓" : "✗"}` +
        `　最陈旧资讯 ${stalest?.name ?? "-"} ${stalest?.days ?? "-"} 天` +
        (empty ? "　⚠空屏" : ""),
    );
  }

  // ---------- 系统面 ----------
  console.log(`\n# 系统面`);

  // ① 自选股「有没有被抓过」——问的是管线，不是行情
  const watchedEntityIds = [...new Set(wlAll.map((w) => w.entityId))];
  const notFetched: { name: string; days: number }[] = [];
  let noFreshNews = 0;
  for (const w of wlAll) {
    if (notFetched.some((s) => s.name === w.entity.name)) continue;
    const ids = [w.entityId, ...w.entity.relFrom.map((r) => r.toId)];
    const fetched = fetchedBy.get(ids.find((i) => fetchedBy.has(i)) ?? "");
    const lastPub = ids.map((i) => lastBy.get(i)).filter((x): x is Date => !!x).sort((a, b) => +b - +a)[0];
    const fetchDays = fetched ? Math.floor((+now - +fetched) / DAY) : 999;
    if (fetchDays > T.staleFetchDays) notFetched.push({ name: w.entity.name, days: fetchDays });
    else if (lastPub && +now - +lastPub > 7 * DAY) noFreshNews++;
  }
  console.log(
    `- 自选实体 ${watchedEntityIds.length} 个：超过 ${T.staleFetchDays} 天没被抓过的 ${notFetched.length} 个；` +
      `抓过但本身近 7 天无新料的 ${noFreshNews} 个（小盘股常态，不告警）`,
  );
  if (notFetched.length > 0) {
    warn(
      `自选股 ${notFetched.length} 只超过 ${T.staleFetchDays} 天没被抓过：${notFetched
        .sort((a, b) => b.days - a.days)
        .slice(0, 6)
        .map((s) => `${s.name}(${s.days}天)`)
        .join("、")} —— 查 targetsByNeed 的自选优先档、ingest 有没有在跑`,
    );
  }

  // ② thesis 验证覆盖率
  const thesisTotal = await db.thesis.count();
  const verified7 = (await db.thesisSignal.groupBy({ by: ["entityId"], where: { publishedAt: { gte: d7 } } })).length;
  console.log(`- 投资逻辑 ${thesisTotal} 份，近 7 天被新证据验证过的实体 ${verified7} 个`);

  // ③ 提醒层
  const p = { hi: alertRows.filter((a) => a.priority >= 30).length, lo: alertRows.filter((a) => a.priority < 30).length };
  // 已读率的分母只算「打开过提醒中心的用户」手上的提醒——从没来过的人当然是未读，
  // 把他们算进来等于用「没人来」去指控「标记功能坏了」。
  const visitors = new Set(
    (
      await db.analyticsEvent.findMany({
        where: { type: "view_notifications", createdAt: { gte: d30 }, userId: { not: null } },
        select: { userId: true },
      })
    ).map((v) => v.userId!),
  );
  const visited = alertRows.filter((a) => visitors.has(a.userId));
  const readRate = visited.length ? visited.filter((a) => a.readAt).length / visited.length : 1;
  console.log(
    `- 提醒 30 天 ${alertRows.length} 条（逻辑异动 ${p.hi} / 资讯 ${p.lo}）；打开过提醒中心的用户手上 ${visited.length} 条，已读率 ${(readRate * 100).toFixed(0)}%`,
  );
  if (alertRows.length > 0 && p.hi === 0) {
    warn("提醒全是 p10 资讯档，逻辑异动一条都没有 —— 查 detect-crossings 有没有在跑、ThesisDimensionState 是否在更新");
  }
  if (visited.length > 0 && readRate < T.alertReadRate) {
    warn(`打开过提醒中心的用户，已读率仅 ${(readRate * 100).toFixed(0)}% —— 自动标已读可能失效（验证要用 shot.ts --wait 停够，别用默认 750ms）`);
  }
  const crossFresh = await db.thesisDimensionState.count({ where: { lastCrossAt: { gte: d7 } } });
  console.log(`- 维度跨越（近 7 天）${crossFresh} 条`);

  // ④ 个人复盘覆盖：拿**最近一次真跑过**的那天比，且分母只算「那时就已经有自选」的用户。
  // 直接拿今天比是错的——daily-digest 15:40 才跑，上午看永远是 0；
  // 而今天凌晨注册的用户也不该算进昨天的分母（8-03 实测：7/14 看着像漏了一半，
  // 其实 8-02 15:40 之前正好 7 个用户有自选，覆盖率是 100%）。
  const lastRun = await db.userDigest.findFirst({
    orderBy: { tradeDate: "desc" },
    select: { tradeDate: true, createdAt: true },
  });
  if (lastRun) {
    const cohort = await db.watchlist.groupBy({
      by: ["userId"],
      where: { createdAt: { lt: lastRun.createdAt } },
    });
    const got = await db.userDigest.groupBy({ by: ["userId"], where: { tradeDate: lastRun.tradeDate } });
    const cov = cohort.length > 0 ? got.length / cohort.length : 1;
    console.log(
      `- 最近一次复盘（${lastRun.tradeDate}）覆盖 ${got.length}/${cohort.length} 个当时有自选的用户（${(cov * 100).toFixed(0)}%）`,
    );
    if (cov < T.digestCoverage) {
      warn(`${lastRun.tradeDate} 的个人复盘只覆盖 ${got.length}/${cohort.length} —— 查 generateUserDigests 的 skipped/rejected 原因`);
    }
  }

  // ⑤ 埋点健康
  // 只看近 24 小时：7 天窗口会把改动前的存量算进来，永远报警（8-03 实测踩过）。
  const d1 = new Date(now.getTime() - DAY);
  const evAll = await db.analyticsEvent.count({ where: { createdAt: { gte: d1 } } });
  const evReal = await db.analyticsEvent.count({ where: { createdAt: { gte: d1 }, userId: { not: null } } });
  const rate = evAll ? evReal / evAll : 1;
  console.log(`- 近 24 小时埋点 ${evAll} 条，其中登录态 ${evReal} 条（${(rate * 100).toFixed(1)}%）`);
  if (evAll > 500 && rate < T.analyticsRealRate) {
    warn(`埋点里 ${(100 - rate * 100).toFixed(0)}% 是匿名流量 —— 浏览类埋点的登录态过滤可能失效`);
  }

  // ⑥ 空屏
  if (activeUsers > 0 && emptyScreen / activeUsers > T.emptyScreenRate) {
    warn(`${emptyScreen}/${activeUsers} 个用户是空屏（四卡全 0、无催化、无客观事实兜底）`);
  }

  // ⑦ 采集管线是否在跑（活着的旁证：最近一条入库时间）
  const freshest = await db.newsItem.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const ingestLagMin = freshest ? Math.round((+now - +freshest.createdAt) / 60000) : 99999;
  console.log(`- 最近一条资讯入库 ${ingestLagMin} 分钟前`);
  if (ingestLagMin > 180) warn(`资讯已 ${ingestLagMin} 分钟没有新入库 —— 查 ingest 任务与外网连通性`);

  console.log(`\n# 结论`);
  if (alerts.length === 0) {
    console.log("AUDIT_OK —— 今天没有需要动手的项");
  } else {
    for (const a of alerts) console.log(`⚠ ${a}`);
  }
  await db.$disconnect();
}

void main();
