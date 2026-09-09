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
// 停摆判据要知道哪些任务是「用户在固定钟点等的」。JOBS 是线上唯一配置来源，
// 且只 import 类型、无副作用，直接读它比在这儿抄一份钟点表可靠。
import { JOBS } from "../scheduler/jobs";

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
  /**
   * OpenRouter 余额下限（美元）。低于它就该充钱了，不是等它归零。
   * 8-31 实测这条 key 一天烧掉 13.8 美元，30 美元≈两天——足够在下一份日报出来之前
   * 把钱充上，又不至于长期挂着一条「钱还很多」的红字。
   */
  creditFloorUsd: 30,
  /**
   * 盘前简报的截止时刻＝ A 股开盘（北京时间）。晚于它落库的那份等于没有：
   * 用户上午打开首页看到的仍是昨天的收盘复盘。
   * 09-01 实测晚了 28 分钟而 `JobRun.status` 是 ok，所以这条只能靠产物时刻判，
   * 判不出来的话 ⑨ 永远看不见它。跟 `schedule.ts` 里 `untilCST: "09:20"` 的补跑截止
   * 是两回事：那个管「还值不值得再试」，这个管「用户到底有没有按时拿到」。
   */
  preopenDeadlineCST: "09:30",
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

/**
 * 报告开头必须说清「这份体检查的是哪个库」，并在查错库时喊出来。
 *
 * 2026-09-07 的教训，也是这个脚本上线以来最贵的一次：8-27 解牛国内上线，生产整体搬到
 * 阿里云 ECS（jieniu.club → 47.99.195.191:3838 → 该机 PostgreSQL），本机 Mac 只剩一份
 * 数据库副本和一个还在跑的 scheduler。而 cron 的提示词里把 `DATABASE_URL` 写死成
 * `postgresql://mac@localhost:5432/jieniu`——于是**连续 11 天，每天的报告都在体检一个
 * 没有任何用户访问的副本**：它报「18 个用户、复盘 100% 覆盖、AUDIT_OK」，同一天线上
 * 真库的 `daily-digest` 失败、一个用户首页没有复盘，一个字都没报出来。
 *
 * 判据本身一条没错，错的是数据源——而报告里没有任何一行能让人看出来。所以补两件事：
 *
 *   1) 开头无条件打印库的身份（host/库名/用户数）。查错库这件事从此在每份报告的第一屏。
 *   2) 判「这台机器在不在给用户提供服务」：本机 3838 端口没有 `next start` 在跑，
 *      就说明这个库不可能是用户打开网页时读的那个。这个判据**不依赖用户流量**——
 *      靠「多久没埋点」是判不出来的，19 个用户的产品本来就常有整周零访问
 *      （实测近 14 天只 6 天有埋点），阈值定多少都会误报或漏报。
 */
async function auditDataSource(): Promise<void> {
  const raw = process.env.DATABASE_URL ?? "";
  let where = "(DATABASE_URL 未设置)";
  try {
    const u = new URL(raw);
    // 只取 host/port/库名——口令绝不进日志。
    where = `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    /* 解析不了就照上面的兜底文案 */
  }
  const users = await db.user.count();
  console.log(`- 体检的库：${where}｜用户 ${users} 人`);

  const port = process.env.JIENIU_PORT ?? "3838";
  let serving = false;
  try {
    const ctl = AbortSignal.timeout(4000);
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: ctl });
    serving = r.status < 500;
  } catch {
    serving = false;
  }
  if (!serving) {
    warn(
      `本机 :${port} 上没有解牛在跑，所以这个库几乎不可能是用户真正读的那个 —— ` +
        `生产在阿里云 ECS（见 docs/reference/deploy.md）。正确跑法：` +
        `ssh aliyun-main 'cd /home/ubuntu/jieniu && set -a && . /etc/jieniu/env && set +a && ` +
        `SKIP_ENV_VALIDATION=1 ./node_modules/.bin/tsx src/scripts/user-audit.ts'。` +
        `在本机副本上跑出来的「一切正常」不能代表任何一个真实用户`,
    );
  }
}

async function main() {
  console.log(`# 用户呈现数据复盘 · ${localDay(now)} ${now.toTimeString().slice(0, 5)}\n`);
  await auditDataSource();

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
    } else if (got.length < cohort.length) {
      // 比例阈值（0.8）拦不住「19 个人里漏 1 个」——18/19 = 95%，它一声不吭。
      // 可对那 1 个人来说，今天首页就是没有复盘，这是实打实的用户可见缺失。
      // 2026-09-07：`cmsaeery` 的模型输出被截断判废，覆盖 18/19，④ 全程沉默；
      // 当天能报出来只是因为 ⑨ 撞上了 job 的 fail 状态——而那条连坐现在已经修掉了
      // （generate-market-digest.ts：少数判废不再让整个 job 失败），
      // 少了这一条，同样的事下次就彻底无人知晓。
      // 点名到人，不是只报个比例：读报告的人要能直接去看这个用户的首页。
      const missing = cohort.map((c) => c.userId).filter((id) => !got.some((g) => g.userId === id));
      warn(
        `${lastRun.tradeDate} 有 ${missing.length} 个用户没拿到个人复盘（${missing.map((id) => id.slice(0, 8)).join("、")}）—— ` +
          `他们今天首页那块是空的；原因看 daily-digest 那轮输出里的「判废」行`,
      );
    }
  }

  // ⑤ 埋点健康
  // 只看近 24 小时：7 天窗口会把改动前的存量算进来，永远报警（8-03 实测踩过）。
  //
  // 这一条只查「匿名流量灌库」（evAll > 500 才判），**不查「今天没人来」**。
  // 2026-08-26 实测过一次，免得下一轮又查：近 14 天只有 6 天有埋点
  // （8-12: 4、8-13: 2、8-18: 53、8-19: 8、8-20: 14、8-24: 4），其余 8 天整天 0 条，
  // 登录态占比每天都是 100%。也就是说**多数日子本来就没有登录用户打开过页面**，
  // 「近 24 小时 0 条」是这个体量的常态，不是埋点坏了。要判「埋点是不是断了」得看
  // 有访问的日子还有没有埋点，靠单日 0 判不出来——所以只把最近一条的时间打出来当旁证。
  const d1 = new Date(now.getTime() - DAY);
  const evAll = await db.analyticsEvent.count({ where: { createdAt: { gte: d1 } } });
  const evReal = await db.analyticsEvent.count({ where: { createdAt: { gte: d1 }, userId: { not: null } } });
  const rate = evAll ? evReal / evAll : 1;
  const lastEvent = await db.analyticsEvent.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const lastEventAgo = lastEvent ? `，最近一次访问 ${localDay(lastEvent.createdAt)}` : "，从未有过访问";
  console.log(`- 近 24 小时埋点 ${evAll} 条，其中登录态 ${evReal} 条（${(rate * 100).toFixed(1)}%）${lastEventAgo}`);
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

  // ⑧ 资金流快照是否在刷新
  //
  // 为什么单独判：`EntitySignal(kind="flow")` 由 ingest 每轮（30 分钟）重采全市场，
  // 它的 label（「主力净流入 X 亿」）**直接摆在首页 quietFacts 上给用户看**，同时还是
  // `targetsByNeed` 判「这只股还活着」的主证据——它不刷新，用户看到隔夜的数，
  // 而新加的自选股会因为「不在快照里 = 不算活」被踢出补料队列，永远抓不到资讯。
  //
  // 而它坏掉的时候一声不响：`fetchAllFlows` 首页失败就返回空，upsert=0，ingest 退出码
  // 照样是 0。2026-08-27 复盘查 JobRun 才发现，近 14 天每天约 46 轮里只有 0~6 轮采到东西
  // （`push2.eastmoney.com` 对本机基本不通），也就是这个快照实际一天只刷新两三次、
  // 已经这样至少一个月。
  //
  // 阈值 180 分钟：跟上面「资讯入库」同一口径，是 30 分钟节拍的 6 倍余量。
  // 注意别放宽到 6 小时——8-27 当天实测滞后 4.4 小时，6 小时就漏了。
  const flowSig = await db.entitySignal.findFirst({
    where: { kind: "flow" },
    orderBy: { asOf: "desc" },
    select: { asOf: true },
  });
  const flowLagMin = flowSig ? Math.round((+now - +flowSig.asOf) / 60000) : 99999;
  console.log(`- 资金流快照 ${flowSig ? `${flowLagMin} 分钟前刷新` : "从来没有过"}`);
  if (flowLagMin > 180) {
    warn(
      `资金流快照已 ${flowLagMin} 分钟没刷新 —— 首页「主力净流入」在给用户看隔夜数，` +
        `且新加自选会被判成死壳抓不到资讯；查 ingest 日志里的 [market-flow] 行`,
    );
  }

  // ⑨ 今天这一趟定时任务到底成没成 —— 查**运行**，不查产物
  //
  // 为什么必须单列：④ 只查「最近一次 `UserDigest.tradeDate`」的覆盖率，而某天整体失败时
  // 那天根本不会出现在 UserDigest 里，于是**被第二天的成功盖掉，永远查不到**。
  // 8-22 实测：当天全绿 AUDIT_OK，可 08-20 的 daily-digest 其实 exit 1（1 份个人复盘被
  // grounding 判废 → 按设计不放宽校验 → 整个 job 失败 → 第二步「生成提醒并发信」连坐跳过，
  // 当天那封邮件没发，15 条积压到次日）。近 30 天 24 次跑里失败 2 次 + 超时 1 次，一次都没报过。
  // 8-28 又复现且严重得多：OpenRouter 余额耗尽，daily-digest 15 秒就 402 失败，
  // 18 个用户当天**一份个人复盘都没有**，审计照旧输出 AUDIT_OK。
  //
  // 这一条跟本脚本前几次「判据自己错」是**反**方向：不是喊狼来了，是该喊没喊，所以是收紧。
  // 排除 running（正在跑的不算失败）；skipped 是调度器自己判的不该跑，也不算。
  const todayDigests = await db.userDigest.count({ where: { tradeDate: localDay(now) } });
  const lastDigestRun = await db.jobRun.findFirst({
    where: { jobKey: "daily-digest" },
    orderBy: { firedAt: "desc" },
    select: { firedAt: true, status: true },
  });
  console.log(
    `- 今天个人复盘 ${todayDigests} 份；daily-digest 最近一次 ` +
      `${lastDigestRun ? `${localDay(lastDigestRun.firedAt)} ${lastDigestRun.firedAt.toTimeString().slice(0, 5)} ${lastDigestRun.status}` : "从来没跑过"}`,
  );
  const badRuns = await db.jobRun.findMany({
    where: { firedAt: { gte: d1 }, status: { notIn: ["ok", "running", "skipped"] } },
    orderBy: { firedAt: "desc" },
    select: { jobKey: true, status: true, firedAt: true, output: true },
  });
  // 补跑成功的失败**不告警**——这是 2026-09-02 实测的第五条「判据自己错」。
  //
  // 当天 preopen-brief 08:14 首跑 125 秒超时 fail，08:32 补跑 45 秒成功，简报 08:33 落库，
  // 距 09:30 开盘还有 57 分钟——用户该看见的东西一样也没少。而 `schedule.ts` 的补跑窗口
  // （`retry: { everySec: 900, untilCST: "09:20" }`）正是 8-31 那次 402 之后专门造出来
  // 兜这种情况的。首跑失败就报 ⚠，等于这个机制**每次正常工作都要拉一次警报**，
  // 而它按设计就该时不时被触发——典型的天天喊狼来了。
  //
  // 「补跑成功」的口径：同一个 jobKey、同一个北京日历日、在这次失败**之后**有一轮 ok。
  // 三个条件都必要：跨天的成功是明天那一趟，压不住今天丢的那份；失败之前的成功更无关。
  // 鉴别力没丢——没有补跑窗口的任务（daily-digest 15:40 那趟）失败后当天不会再有 ok 轮，
  // 照旧 ⚠，8-28 那次 18 个用户没复盘仍然报得出来。
  const sameDayRuns = await db.jobRun.findMany({
    where: { firedAt: { gte: d1 }, status: "ok", jobKey: { in: badRuns.map((r) => r.jobKey) } },
    select: { jobKey: true, firedAt: true },
  });
  for (const r of badRuns) {
    // 失败原因取 output 里第一行带「失败:」的——脚本约定把死因写在那儿，比 exitCode 有信息量
    const reason = (r.output ?? "").split("\n").find((l) => l.includes("失败:"))?.trim() ?? "";
    const at = r.firedAt.toTimeString().slice(0, 5);
    const rescue = sameDayRuns
      .filter(
        (o) => o.jobKey === r.jobKey && +o.firedAt > +r.firedAt && localDay(o.firedAt) === localDay(r.firedAt),
      )
      .sort((a, b) => +a.firedAt - +b.firedAt)[0];
    if (rescue) {
      const gapMin = Math.round((+rescue.firedAt - +r.firedAt) / 60000);
      console.log(
        `- ${r.jobKey} ${at} 首跑失败，${gapMin} 分钟后 ${rescue.firedAt.toTimeString().slice(0, 5)} 补跑成功` +
          `（补跑机制生效，不算事故）${reason ? ` —— 首跑死因：${reason.slice(0, 120)}` : ""}`,
      );
      continue;
    }
    warn(
      `${r.jobKey} ${at} ${r.status}` +
        (reason ? ` —— ${reason.slice(0, 180)}` : "") +
        `（当天之后没有任何一轮成功）` +
        (r.jobKey === "daily-digest"
          ? `（今天个人复盘 ${todayDigests} 份；第二步「生成提醒并发信」被连坐跳过 = 当天提醒邮件没发出去）`
          : ""),
    );
  }

  // ⑨b 盘前简报**赶没赶上开盘** —— 查产物 + 查截止时刻，不只查 exit code
  //
  // 2026-09-02 复盘时逐日拉产物才发现：09-01 的盘前简报 09:58 才落库，比 09:30 开盘晚
  // 28 分钟，而那一跑 `JobRun.status` 是 **ok**——⑨ 只看运行成没成，对它完全无感。
  // 根因是调度器 05:58 到 09:54 断了 236 分钟（`ingest` 卡在 running 再没写完，
  // 恢复后 7 个任务同一秒补火），preopen-brief 顺延到 09:58 才跑。
  // 后果实测得到：`briefRouter.today` 的优先级是「当天 close > 当天 preopen > 最近一条」，
  // 所以那天早上 09:58 之前首屏挂的是 08-31 的**收盘**复盘——正是 7-31 张楚寒
  //「昨晚美股的信息没 update 上去」那条反馈，盘前简报这个功能本身就是为它造的。
  //
  // 跟 ⑨ 是**互补**而不是重复：⑨ 抓「跑挂了」，这条抓「跑成了但太晚，用户看的还是昨天那份」。
  // 迟到的盘前简报等于没有，所以判据是截止时刻而不是「有没有」。
  //
  // 为什么不挂交易日历：这个任务 08-07 上线以来 27 天**每天**都跑、每天都出产物，
  // 周六周日一样有（08-15、08-16、08-22、08-23、08-29、08-30 都在库里），
  // 三次缺口全是真故障（08-08、08-31 的 402、09-01 的调度器停摆）。
  // 所以「每天都该有一份」是实测出来的现状，不需要再判是不是交易日。
  const preopenToday = await db.marketDigest.findFirst({
    where: { tradeDate: localDay(now), market: "CN", session: "preopen" },
    select: { createdAt: true },
  });
  const openAt = new Date(now);
  const [oh, om] = T.preopenDeadlineCST.split(":").map(Number);
  openAt.setHours(oh ?? 9, om ?? 30, 0, 0);
  if (+now < +openAt) {
    // 还没到开盘——这时候「没有」是正常的，不是故障。手工在早上跑本脚本会走到这里。
    console.log(`- 盘前简报：现在还没到 ${T.preopenDeadlineCST} 开盘，不判`);
  } else if (!preopenToday) {
    warn(
      `今天没有盘前简报（MarketDigest ${localDay(now)}/CN/preopen 不存在）` +
        ` —— 整个上午首页挂的是昨天的收盘复盘，隔夜美股按定义没进去`,
    );
  } else {
    const lateMin = Math.round((+preopenToday.createdAt - +openAt) / 60000);
    console.log(
      `- 盘前简报 ${preopenToday.createdAt.toTimeString().slice(0, 5)} 落库` +
        `（${lateMin <= 0 ? `早于 ${T.preopenDeadlineCST} 开盘 ${-lateMin} 分钟` : `晚于开盘 ${lateMin} 分钟`}）`,
    );
    if (lateMin > 0) {
      warn(
        `盘前简报 ${preopenToday.createdAt.toTimeString().slice(0, 5)} 才落库，比 ${T.preopenDeadlineCST} 开盘晚 ${lateMin} 分钟` +
          ` —— 开盘后才到的盘前简报没有意义，那之前首页给用户看的是昨天的收盘复盘。` +
          `查调度器那段时间有没有停摆（JobRun 时间轴空档 / 卡住的 running 行）`,
      );
    }
  }

  // ⑨c 调度器自己停摆 —— 卡在 running 再也没写完的轮次
  //
  // 09-01 那 236 分钟的空档，现场只留下一条证据：`ingest` 05:58 那行 status 一直是
  // running、`finishedAt` 永远为空。⑨ 明确排除了 running（「正在跑的不算失败」），
  // 于是这条唯一的线索正好从判据里漏出去，当天审计一个字都没报。
  //
  // 阈值 2 小时：全库最长的单步超时是 preopen-brief 的 30 分钟，跑得最久的
  // market-daily-refill 实测 626 秒（约 10.5 分钟）。超过 2 小时还 running 的只可能是
  // 进程没了。实测全库只有 2 行满足，正是 08-31 16:32 和 09-01 05:58 两次故障，
  // 平时为 0——不会天天响。窗口跟其余判据一样限 24 小时，故障当天报一次，过后自动闭嘴。
  //
  // 2026-09-03 补：检测本身是对的（当天真抓到 09-02 18:30 那次 288 分钟停摆），
  // 但原来那句话把读报告的人指向了两个死胡同——「查 pm2」「查机器有没有休眠」。
  // 实测两个都是好的：机器 33 天没重启、pmset 日志里整天没有一条 Sleep；
  // 调度器自己在重启时就把这次停摆认出来并处理了（错误日志原文：
  // 「backfill-announcements 的 runningAt 卡了 288 分钟，判定死锁并释放」）。
  // 于是一整个会话花在重建「停了多久、恢复没有、用户丢没丢东西」——而这三件事
  // 审计手里就有数据可以直接算出来。所以下面改成自己把它们算完再说话：
  //
  //   1) 停摆区间＝这行卡住的 firedAt →（时间上）下一条 JobRun 的 firedAt。
  //      没有下一条＝**现在还躺着**，这是唯一需要立刻动手的分支，措辞要重。
  //   2) 恢复了就说清楚几点恢复的。这类停摆靠调度器重启自愈，事后再喊「去查 pm2」
  //      只会让人查到一个健康的进程，然后怀疑判据在乱报。
  //   3) **区间里压没压到 `kind: "daily"` 的钟点**——这才是「用户有没有丢东西」。
  //      interval 类（ingest/backfill-*/market-daily-refill）停几轮只是资讯旧几小时，
  //      恢复后照常补；daily 类是用户在固定钟点等的产物，错过就是那天没有。
  //      两次实测正好是这条判据的两端：09-01 停在 05:58–09:54，压到 brief-morning
  //      07:20 和 preopen-brief 08:15，用户整个上午看的是前一天的收盘复盘；
  //      09-02 停在 18:30–23:18，六个 daily 钟点（03:10/04:30/07:20/08:15/15:40/15:50）
  //      一个都没压到，用户端零损失。同样是「288 分钟」，代价差着一个数量级，
  //      报告不该用同一句话说这两件事。
  //      钟点直接从 `scheduler/jobs.ts` 的 JOBS 读——那是线上唯一配置来源，
  //      在这儿抄一份钟点表迟早会跟真配置对不上。
  const stuckRuns = await db.jobRun.findMany({
    where: { firedAt: { gte: d1, lt: new Date(+now - 2 * 3600_000) }, status: "running" },
    select: { jobKey: true, firedAt: true },
  });
  /** 卡住但调度器没停的轮次——只记一行，不告警。判据见下面那段注释。 */
  const orphanRows: string[] = [];
  for (const s of stuckRuns) {
    const next = await db.jobRun.findFirst({
      where: { firedAt: { gt: s.firedAt } },
      orderBy: { firedAt: "asc" },
      select: { firedAt: true },
    });
    const endedAt = next?.firedAt ?? now;
    const gapMin = Math.round((+endedAt - +s.firedAt) / 60000);
    // 钟点要带日期。窗口常常落在昨天（判据看的是近 24 小时），只打 HH:MM 的话
    // 「19:08 到 19:19 停摆」在一份标着今天的报告里读起来就是今天——09-07 实测被这么误读过。
    const stamp = (d: Date) =>
      (localDay(d) === localDay(now) ? "" : `${localDay(d).slice(5)} `) + d.toTimeString().slice(0, 5);
    const from = stamp(s.firedAt);
    const to = stamp(endedAt);

    // 区间里被跳过的 daily 钟点。跨天的停摆也要算对，所以逐天推锚点而不是只比钟点字符串。
    //
    // 光「压到钟点」还不能算用户丢了东西：调度器一重启就会把错过的轮次补火（09-02 那次
    // 23:18:59 一秒内连开五个）。所以每个被压到的锚点还要再问一句「当天补上没有」——
    // 口径跟 ⑨ 的补跑窗口一致：同 jobKey、同北京日历日、锚点之后有一轮 ok。
    // 实测就是靠这一步把 09-02 从「跳过 institutional-trace 19:10」修正成
    //「晚了 248 分钟补上」——它 23:18 那轮是 ok 的，用户拿到了，只是晚。
    // 少了这步，任何跨过任意一个 daily 钟点的停摆都会报「用户没拿到」，
    // 而补火机制每正常工作一次就被算成一次事故。
    const missed: string[] = [];
    const late: string[] = [];
    /** 被压到的锚点里，补跑落地得最晚的那个晚了多少分钟。停摆判据要用它。 */
    let lateMaxMin = 0;
    // 推锚点必须按**日历日**走，不能拿 firedAt 当游标加一天：那样游标会一直带着停摆
    // 开始的时刻（比如 22:00），`+d <= +endedAt` 在跨午夜时第二天就直接不成立，
    // 于是 22:00 → 次日 09:00 这种停摆报「一个 daily 钟点都没压到」——而这恰恰是
    // 最该喊的形状（整夜没跑，早报 07:20 和盘前简报 08:15 全丢）。
    // 09-03 写这段时就是这么错的，靠拿四个区间过一遍才看出来：同日的三个都对，
    // 唯独跨午夜那个静默。所以游标在这儿先归零到当天 00:00。
    const firstDay = new Date(s.firedAt);
    firstDay.setHours(0, 0, 0, 0);
    const lastDay = new Date(endedAt);
    lastDay.setHours(0, 0, 0, 0);
    for (const j of JOBS) {
      if (j.schedule.kind !== "daily") continue;
      const [jh, jm] = j.schedule.atCST.split(":").map(Number);
      for (const d = new Date(firstDay); +d <= +lastDay; d.setDate(d.getDate() + 1)) {
        const anchor = new Date(d);
        anchor.setHours(jh ?? 0, jm ?? 0, 0, 0);
        if (+anchor <= +s.firedAt || +anchor >= +endedAt) continue;
        const dayEnd = new Date(anchor);
        dayEnd.setHours(23, 59, 59, 999);
        const caughtUp = await db.jobRun.findFirst({
          where: {
            jobKey: j.key,
            status: "ok",
            firedAt: { gt: anchor, lte: dayEnd },
          },
          orderBy: { firedAt: "asc" },
          select: { firedAt: true },
        });
        if (caughtUp) {
          const lateMin = Math.round((+caughtUp.firedAt - +anchor) / 60000);
          lateMaxMin = Math.max(lateMaxMin, lateMin);
          late.push(
            `${j.key}（${j.schedule.atCST} → ${caughtUp.firedAt.toTimeString().slice(0, 5)}，晚 ${lateMin} 分钟）`,
          );
        } else {
          missed.push(`${j.key} ${j.schedule.atCST}`);
        }
        break;
      }
    }
    const cost = missed.length
      ? `窗口里这些用户在固定钟点等的产物当天再没补上：${missed.join("、")} —— 那天这些用户是真没拿到`
      : late.length
        ? `窗口压到了 ${late.join("、")}，但恢复后当天都补跑成功了，用户拿到了、只是晚；` +
          `其余只停了 interval 类，资讯旧了约 ${Math.round(gapMin / 60)} 小时`
        : `窗口里没有任何 daily 任务的钟点（只停了 interval 类），用户端只是资讯旧了约 ${Math.round(gapMin / 60)} 小时，没丢产物`;

    // 一行卡在 running ≠ 调度器停摆 —— 2026-09-07 实测的第六条「判据自己错」，而且是
    // 这个脚本迄今最吵的一次：一天报了 5 条「停摆」，5 条全是假的。
    //
    // 反证一眼就成立：`backfill-signals` 10:18 那轮卡住了，可 `ingest` 10:19 照常起跑、
    // 跑满 437 秒还写下了 fail，`market-daily-refill` 10:33 跑完 ok——进程活得好好的。
    // 真实原因是本机当天重启了 3 次（10:27:36 开机，日志里同刻是 `FATAL: the database
    // system is shutting down` + DNS ENOTFOUND），Postgres 在任务中途被拉走，
    // 那句写「done」的 `jobRun.update()` 失败，状态行就永远停在 running 了。
    // 调度器随后自己释放死锁（「runningAt 卡了 70 分钟，判定死锁并释放」）让任务恢复，
    // 但从不回填那一行——lessons.md 里那条「自愈清了锁却不回填状态行」说的就是它。
    //
    // 而原来的算法拿「下一条 JobRun 的 firedAt」当停摆终点，于是算出来的是**任务间的正常
    // 节奏**，不是停摆时长：今天五条分别是 1 / 10 / 11 / 12 / 42 分钟。「停摆 1 分钟」
    // 这种话本身就自相矛盾——进程真没了，下一个任务不可能一分钟后起跑。
    //
    // 所以改成两个条件择一才算停摆，其余只在系统面记一行：
    //   1) 空档 ≥ 60 分钟。实测正常相邻间隔 p50 8–10 分钟、p95 26–30、线上 7 天最大 37；
    //      两次真停摆是 236 和 288 分钟。60 分钟落在两者之间、离两边都远。
    //   2) 或者窗口压到了 daily 钟点——短而刁的停摆（比如 20 分钟正好压住早报 07:20）
    //      用户照样丢东西，鉴别力不能只交给时长。
    const STALL_MIN_GAP_MIN = 60;
    //
    // 「压到了 daily 钟点」这个条件必须写成**当天没补上，或补上但晚太多**，不能写成
    // `late.length > 0`。补火机制按设计就会把错过的轮次立刻重放，09-07 19:08 那次
    // `institutional-trace` 只晚了 9 分钟——按 late 一有就报，等于这个机制每正常工作
    // 一次就拉一次警报，跟 lessons.md 里「补跑成功不该告警」是同一条。
    // 晚 60 分钟以上才算用户真受影响（对照：09-02 那次晚了 248 分钟）。
    const isStall =
      !next || gapMin >= STALL_MIN_GAP_MIN || missed.length > 0 || lateMaxMin >= STALL_MIN_GAP_MIN;
    if (!isStall) {
      orphanRows.push(`${s.jobKey} ${from}`);
      continue;
    }

    warn(
      next
        ? `调度器 ${from} 到 ${to} 停摆 ${gapMin} 分钟（现场证据：${s.jobKey} ${from} 那轮卡在 running 再没写完），` +
            `${to} 已自行恢复、之后一直正常。${cost}。` +
            `不用再查 pm2 或休眠——这类停摆靠调度器重启时的死锁释放自愈，事后查只会查到一个健康的进程`
        : `⛔ 调度器从 ${from} 起停摆 ${gapMin} 分钟，到现在**还没恢复**（${s.jobKey} 那轮卡在 running，之后再没有任何任务起跑）` +
            ` —— 立刻看 pm2 jieniu-scheduler，按 docs/reference/deploy.md 用 scripts/start-scheduler.sh 拉起来。${cost}`,
    );
  }

  if (orphanRows.length > 0) {
    console.log(
      `- ${orphanRows.length} 轮任务的状态行永远停在 running（${orphanRows.join("、")}）——` +
        `调度器没停、后面的任务照常起跑，是死锁自愈时没回填这一行。不影响用户`,
    );
  }

  // ⑩ AI 供应商没钱了 —— 静默降级，job 照样 exit 0
  //
  // `backfill-signals` 对每条新闻单独 try/catch：402 只打一行 `✗ … openrouter 402` 就继续，
  // 整轮 status 仍是 ok。8-28 实测那一轮 150 条新闻**全部** 402、证据一条没抽出来，
  // 而 ⑨ 看不见它（status=ok），④⑦⑧ 也看不见（产物是别的管线写的）。
  //
  // 匹配串必须带上下文：裸 `402` 会撞上别的任务输出里的耗时「(402s)」——
  // market-daily-refill 和 opportunity-radar 都打这个格式，实测会误报。
  const day1Runs = await db.jobRun.findMany({
    where: { firedAt: { gte: d1 } },
    select: { jobKey: true, output: true },
  });
  const creditHits = day1Runs.filter((r) => /openrouter 402|more credits|insufficient credit/i.test(r.output ?? ""));
  if (creditHits.length > 0) {
    const jobs = [...new Set(creditHits.map((r) => r.jobKey))];
    warn(
      `近 24 小时 ${creditHits.length} 次运行撞上 OpenRouter 402 余额不足（${jobs.join("、")}）` +
        ` —— 充值前所有 AI 环节都在静默降级：收盘复盘、证据抽取、机会雷达。查余额：` +
        `secret exec OPENROUTER_API_KEY -- sh -c 'curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/credits'`,
    );
  }

  // ⑪ 余额还剩多少 —— 把事后报警补成事前报警
  //
  // ⑩ 只在**已经**烧穿之后才响：8-28、8-31 两次都是先丢了用户当天的东西
  // （8-28 一份个人复盘都没有；8-31 整个上午没有盘前简报），第二天早上才知道。
  // 余额是提前一周就能看见的数，没有理由等它归零。
  //
  // 要 key 才查得到，所以做成**可选**：cron 里给这个脚本套上
  // `secret exec OPENROUTER_API_KEY -- env DATABASE_URL=… npx tsx …` 就生效。
  // 没套时打一行「未查」而不是静默跳过——否则这条判据哪天失效了没人看得出来。
  await reportCredits();

  console.log(`\n# 结论`);
  if (alerts.length === 0) {
    console.log("AUDIT_OK —— 今天没有需要动手的项");
  } else {
    for (const a of alerts) console.log(`⚠ ${a}`);
  }
  await db.$disconnect();
}

/**
 * OpenRouter 余额。这条判据是 8-28 / 8-31 两次「余额烧穿→全线 AI 静默降级」之后补的
 * **事前**预警；JobRun 非 ok 和 402 那两条只能在用户已经拿到降级产物之后才亮。
 *
 * 所以它自己不许静默失灵。09-09 实测：报告里印了一行「查不到（fetch failed）」，
 * 结论仍然是 AUDIT_OK —— 余额真要是只剩 5 美元，那天照样什么都不会说。
 * 同一时刻手工连测 10 次全部 200，说明那是一次偶发抖动，不是墙也不是 key 坏了。
 *
 * 现在的口径：失败重试 3 次；3 次都不成才认，并且认了就要 warn ——
 * 「这条预警今天没跑成」本身就是要告诉人的事，不能只印一行灰字。
 * 401/403 不重试：那是 key 被吊销或额度被封，重试一百次也是同一个答案，直接报。
 * 依然绝不让脚本挂掉：整段包在 try 里，任何一条判据都不该有能力阻断其余判据。
 */
async function reportCredits(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.log("- OpenRouter 余额：未查（本次运行没有 OPENROUTER_API_KEY）");
    warn(
      "体检没拿到 OPENROUTER_API_KEY，余额下限这条事前预警本次没跑 —— " +
        "余额烧穿会让收盘复盘、盘前简报、证据抽取全线静默降级（8-28、8-31 各出过一次）。" +
        "正确跑法见 docs/reference/deploy.md：在 ECS 上 `set -a && . /etc/jieniu/env && set +a` 之后再跑。",
    );
    return;
  }

  const attempts = 3;
  let lastErr = "";
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.status === 401 || r.status === 403) {
        console.log(`- OpenRouter 余额：查不到（HTTP ${r.status}）`);
        warn(
          `OpenRouter 认证失败（HTTP ${r.status}）—— key 被吊销或额度被封，不是网络问题。` +
            " 这把 key 一停，收盘复盘、盘前简报、证据抽取、机会雷达全线静默降级。" +
            " 查账号：https://openrouter.ai/settings/keys",
        );
        return;
      }
      if (!r.ok) {
        lastErr = `HTTP ${r.status}`;
        if (i < attempts) continue;
        break;
      }
      const j = (await r.json()) as { data?: { total_credits?: number; total_usage?: number } };
      const credits = j.data?.total_credits;
      const used = j.data?.total_usage;
      if (typeof credits !== "number" || typeof used !== "number") {
        console.log("- OpenRouter 余额：查不到（返回体没有 total_credits/total_usage）");
        warn(
          "OpenRouter 余额接口返回体里没有 total_credits/total_usage —— 对方改了字段名，" +
            "余额下限这条事前预警从此形同虚设，得照新字段改这段代码。",
        );
        return;
      }
      const left = credits - used;
      console.log(
        `- OpenRouter 余额 ${left.toFixed(2)} 美元（已充 ${credits} / 已用 ${used.toFixed(2)}）` +
          (i > 1 ? `（第 ${i} 次尝试才通）` : ""),
      );
      if (left < T.creditFloorUsd) {
        warn(
          `OpenRouter 余额只剩 ${left.toFixed(2)} 美元（低于 ${T.creditFloorUsd} 的下限，约两天用量）` +
            ` —— 烧穿之后所有 AI 环节静默降级：收盘复盘、盘前简报、证据抽取、机会雷达。` +
            ` 充值：https://openrouter.ai/settings/credits`,
        );
      }
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  console.log(`- OpenRouter 余额：查不到（${attempts} 次都失败，最后一次 ${lastErr}）`);
  warn(
    `OpenRouter 余额连查 ${attempts} 次都没成（最后一次：${lastErr}）—— 余额下限这条事前预警本次没跑成。` +
      ` 它是 8-28、8-31 两次「余额烧穿→全线 AI 静默降级」之后补的唯一事前预警，` +
      ` 停一天就等于那天没人看着钱。手工确认：` +
      `secret exec OPENROUTER_API_KEY -- sh -c 'curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/credits'`,
  );
}

void main();
