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
   * 「多久没有**关于它**的新资讯入库」的上限——判据是入库时刻 createdAt，不是新闻发布时刻。
   * 实测：王子新材最新发布停在 7-13，但 8-03 04:55 刚抓过 18 条——是这只股没新料，
   * 不是管线没跑。用 publishedAt 判会把所有小盘股天天报成异常。
   */
  staleFetchDays: 2,
  /**
   * 陈旧要**成片**才告警：占自选股的比例下限 + 只数下限（两个都要满足）。
   *
   * 2026-08-05 实测，这是本脚本第四条「判据自己错」：大普微-UW(301666) 被报
   * 「3 天没被抓过」。逐层证伪的结果是管线全速在跑——它是 `targetsByNeed` 队列的
   * **第 1 名**（自选优先档里 bound 最低，127），每轮 ingest（30 分钟）必抓；当场实拉
   * 源接口返回 20 条、16 条已在库（最近一条 2 小时前入库），**而绑到它的 0 条**。
   * 因为近期提到它的全是「融资客控盘比例超一成个股（附名单）」「8月4日创业板活跃股
   * 排行榜」「存储芯片概念下跌3.15%，主力资金净流出134股」这类榜单综述，按归因规则
   * **正确地**不绑主体（「绑定到它」≠「关于它」）。于是这个数冻在 8-01，管线却没停过。
   *
   * 根子上：它走 `NewsEntity` 连接，回答的是「有没有抓到一条**关于它**的资讯」，
   * 回答不了「有没有去抓它」——后者全站没有任何地方记录（无每股抓取日志）。
   * 单只陈旧因此不可判，改看**面**：7-30 那次真空转是 5 条补料路径 100% 停摆、
   * 全部自选股一起陈旧，成片是管线故障的固有形状；单只陈旧几乎总是这只股本身没料。
   */
  staleFetchRate: 1 / 3,
  staleFetchMin: 3,
  /** 个人复盘覆盖率下限（有自选的用户里拿到复盘的比例）。 */
  digestCoverage: 0.8,
  /**
   * 提醒已读率下限。停留 800ms 自动标已读，且 markRead 一次标掉全部未读——
   * 所以「用户末次**真**访问之前就存在的提醒」应当接近全被标上（8-04、8-05 实测均 15/15）。
   * 留 0.5 的余量给「打开就秒退（<800ms）」这类正常人类行为。
   * 分母怎么算见下面 ③ 那段注释——它比这个阈值重要得多。
   */
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
      select: { userId: true, kind: true, priority: true, readAt: true, emailedAt: true, title: true, occurredAt: true, createdAt: true },
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

  // ① 自选股「有没有资讯进来」——问的是管线，不是行情
  const watchedEntityIds = [...new Set(wlAll.map((w) => w.entityId))];
  const stale: { name: string; days: number }[] = [];
  const never: string[] = [];
  const seenName = new Set<string>();
  let noFreshNews = 0;
  for (const w of wlAll) {
    if (seenName.has(w.entity.name)) continue; // 多个用户自选同一只，只数一次
    seenName.add(w.entity.name);
    const ids = [w.entityId, ...w.entity.relFrom.map((r) => r.toId)];
    // 孪生实体（COMPANY + STOCK）取**最新**的那份，与 lastPub 同口径。原来用
    // `ids.find(...)` 拿第一个有值的，会让 COMPANY 的旧时刻压过 STOCK 的新时刻。
    const fetched = ids.map((i) => fetchedBy.get(i)).filter((x): x is Date => !!x).sort((a, b) => +b - +a)[0];
    const lastPub = ids.map((i) => lastBy.get(i)).filter((x): x is Date => !!x).sort((a, b) => +b - +a)[0];
    if (!fetched) {
      never.push(w.entity.name);
      continue;
    }
    const fetchDays = Math.floor((+now - +fetched) / DAY);
    if (fetchDays > T.staleFetchDays) stale.push({ name: w.entity.name, days: fetchDays });
    else if (lastPub && +now - +lastPub > 7 * DAY) noFreshNews++;
  }
  const staleList = stale
    .sort((a, b) => b.days - a.days)
    .slice(0, 6)
    .map((s) => `${s.name}(${s.days}天)`)
    .join("、");
  console.log(
    `- 自选实体 ${watchedEntityIds.length} 个：超过 ${T.staleFetchDays} 天没有新资讯入库的 ${stale.length} 个` +
      (stale.length > 0 ? `（${staleList}）` : "") +
      `；有资讯但本身近 7 天无新料的 ${noFreshNews} 个（小盘股常态，不告警）`,
  );
  // 「一条资讯都没有」是没有歧义的——这只股压根没进过任何抓取队列（多半是 alive 判据把它当死壳）。
  if (never.length > 0) {
    warn(
      `自选股 ${never.length} 只**从来没有过任何资讯**：${never.slice(0, 6).join("、")}` +
        ` —— 查 targetsByNeed 的 alive 判据（资金流快照 / 近 30 天一手公告）有没有把它剔掉`,
    );
  }
  // 单只陈旧不可判（见 T.staleFetchRate 注释），成片才是管线空转。
  if (stale.length >= T.staleFetchMin && stale.length / seenName.size >= T.staleFetchRate) {
    warn(
      `自选股 ${stale.length}/${seenName.size} 只超过 ${T.staleFetchDays} 天没有新资讯入库：${staleList}` +
        ` —— 成片陈旧才是管线空转，查 targetsByNeed 队头与 ingest 日志`,
    );
  }

  // ② thesis 验证覆盖率
  const thesisTotal = await db.thesis.count();
  const verified7 = (await db.thesisSignal.groupBy({ by: ["entityId"], where: { publishedAt: { gte: d7 } } })).length;
  console.log(`- 投资逻辑 ${thesisTotal} 份，近 7 天被新证据验证过的实体 ${verified7} 个`);

  // ③ 提醒层
  const p = { hi: alertRows.filter((a) => a.priority >= 30).length, lo: alertRows.filter((a) => a.priority < 30).length };
  // 已读率的分母只算「用户**有机会看到**的提醒」＝ 入库时刻早于该用户末次打开提醒中心。
  // 收紧过两次，两次都是因为分母混进了「不可能已读」的条目：
  // ① 从没来过提醒中心的用户手上的提醒——等于用「没人来」去指控「标记功能坏了」；
  // ② 2026-08-04：末次访问**之后**才产生的提醒——用户还没机会看到它。实测 32 条里
  //    17 条属于②（tms 末次访问 7-28、之后来了 7 条），把已读率压到 47% 报警；
  //    剔掉后 15/15 = 100%，功能是好的。这跟「埋点别用 7 天窗口」是同一个形状：
  //    分母里混进了在被测行为之外产生的存量。
  // ③ 2026-08-05：`view_notifications` **不等于**「人打开了提醒中心」。这个埋点是在
  //    /notifications 的服务端组件里 `await` 出去的，所以任何一次服务端渲染都会记一笔，
  //    包括**不水合**的预取渲染——而 800ms 自动标已读只在真正水合的客户端上跑。
  //    实测证据：tms 8-05 01:51:03 的三条埋点是 view_entity(.398) → view_notifications(.582)
  //    → view_home(.635)，**240 毫秒跨三个页面**，人做不到；近 7 天 135 条里 53 条是
  //    这种「<1s 同批」。而 `AlertEvent.readAt` 全库只被写过 3 次，每次都紧挨着一条
  //    **孤立**的 view_notifications（swaylq 8-03 06:26:15.788 读 / 06:26:15.835 埋点，
  //    差 47 毫秒）——即：孤立埋点＝真水合访问，标已读照常工作；同批埋点＝预取，本就不该标。
  //    所以「末次访问」只认孤立埋点：同用户 ±1 秒内没有其它 view_* 埋点。
  //    剔掉同批后：15/15 = 100%（不剔是 30 条 50%，正好压在阈值上，明天就会喊狼来了）。
  // 收紧后判据仍有鉴别力：`inbox.markRead` 不传 id 时把该用户**全部**未读一次标掉
  // （不分页、不只标当前屏），所以「产生于末次真访问之前却仍未读」只可能是自动标已读真的失效。
  const BURST_MS = 1000;
  const views = await db.analyticsEvent.findMany({
    where: { type: { startsWith: "view_" }, createdAt: { gte: d30 }, userId: { not: null } },
    select: { id: true, userId: true, type: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const viewsByUser = new Map<string, typeof views>();
  for (const v of views) {
    const a = viewsByUser.get(v.userId!) ?? [];
    a.push(v);
    viewsByUser.set(v.userId!, a);
  }
  const lastVisit = new Map<string, Date>();
  for (const [uid, list] of viewsByUser) {
    for (const v of list) {
      if (v.type !== "view_notifications") continue;
      const near = list.some(
        (o) => o.id !== v.id && Math.abs(+o.createdAt - +v.createdAt) <= BURST_MS,
      );
      if (near) continue; // 同批 = 预取渲染，没水合过，不算「打开过」
      const prev = lastVisit.get(uid);
      if (!prev || v.createdAt > prev) lastVisit.set(uid, v.createdAt);
    }
  }
  const visited = alertRows.filter((a) => {
    const lv = lastVisit.get(a.userId);
    return lv !== undefined && a.createdAt <= lv;
  });
  const pending = alertRows.filter((a) => {
    const lv = lastVisit.get(a.userId);
    return lv !== undefined && a.createdAt > lv;
  }).length;
  const readRate = visited.length ? visited.filter((a) => a.readAt).length / visited.length : 1;
  console.log(
    `- 提醒 30 天 ${alertRows.length} 条（逻辑异动 ${p.hi} / 资讯 ${p.lo}）；用户真打开过提醒中心后才算数的 ${visited.length} 条，已读率 ${(readRate * 100).toFixed(0)}%（另有 ${pending} 条产生于其末次真访问之后，尚未有机会读）`,
  );
  if (alertRows.length > 0 && p.hi === 0) {
    warn("提醒全是 p10 资讯档，逻辑异动一条都没有 —— 查 detect-crossings 有没有在跑、ThesisDimensionState 是否在更新");
  }
  if (visited.length > 0 && readRate < T.alertReadRate) {
    warn(`真打开过提醒中心的用户，已读率仅 ${(readRate * 100).toFixed(0)}% —— 自动标已读可能失效（验证要用 shot.ts --wait 停够，别用默认 750ms；注意这一验证本身会写 readAt，别拿它自己的战果当健康证据）`);
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
