// 过去一年一手公告回填（sway 2026-07-23：「把过去一年的新闻都抓过来，使得整个产品看起来非常完善」）。
//
// 现状实测：覆盖股平均只有 11.1 条已绑定资讯、737/801 只落在 5–19 条，且几乎全在最近 3 周——
// 个股页打开只有十来条本月新闻，这就是「不完善」的根因。
//
// 走东财公告接口的 stock_list + begin_time/end_time（每只约 3.5 页、page_size=50），
// 巨潮 pageSize 服务端硬上限 30 且要多查一次 orgId，故不用巨潮。全链路纯规则、零 AI 调用。
//
// 判重走 runner 的 backfill 模式（按目标实体 + 发布区间载入，判重键带发布日）——
// 既杀得掉与巨潮已有条目的跨源重复，又保得住「回购进展公告」这类一年重复十几次的真实事件。
//
// 用法：
//   ... npx tsx src/scripts/backfill-year.ts [--months=12] [--limit=60] [--offset=0] [--batch=10]
// 幂等：hash 去重，重跑安全；分批跑完 801 只。

import { PrismaClient } from "../../generated/prisma";
import { ingestSource } from "../server/ingest/runner";
import { eastmoneyAnnForCodes } from "../server/ingest/sources/eastmoney-ann";
import { targetsByNeed, numArg } from "../server/backfill-targets";

const db = new PrismaClient();

async function main() {
  const months = numArg("months", 12);
  const limit = numArg("limit", 60);
  const offset = numArg("offset", 0);
  const batchSize = Math.max(1, numArg("batch", 10));

  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - months);

  const all = await targetsByNeed(db);
  const batchTargets = all.slice(offset, offset + limit);
  console.log(
    `覆盖股 ${all.length} 只 → 本轮回填 [${offset}, ${offset + batchTargets.length}) 共 ${batchTargets.length} 只` +
      `，区间 ${from.toISOString().slice(0, 10)} ~ ${to.toISOString().slice(0, 10)}`,
  );
  if (batchTargets.length === 0) return;

  let fetched = 0;
  let inserted = 0;
  let screened = 0;
  const started = Date.now();

  for (let i = 0; i < batchTargets.length; i += batchSize) {
    const group = batchTargets.slice(i, i + batchSize);
    const codes = group.map((g) => g.code);
    const entityIds = group.flatMap((g) => g.entityIds);
    try {
      const r = await ingestSource(db, eastmoneyAnnForCodes(codes, from, to), {
        backfill: { entityIds, publishedFrom: from, publishedTo: to },
      });
      fetched += r.fetched;
      inserted += r.inserted;
      screened += r.screened;
      const done = i + group.length;
      const rate = (Date.now() - started) / done;
      const eta = Math.round(((batchTargets.length - done) * rate) / 1000);
      console.log(
        `  [${done}/${batchTargets.length}] ${group.map((g) => g.name).join(" ")}` +
          ` → fetched=${r.fetched} inserted=${r.inserted} screened=${r.screened}` +
          ` | 累计入库 ${inserted} | 剩余约 ${eta}s`,
      );
    } catch (e) {
      console.error(
        `  批次 ${codes.join(",")} 失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  console.log(
    `\n本轮完成：抓取 ${fetched} 条 → 入库 ${inserted} 条（过滤/已存在 ${fetched - inserted} 条，其中源头筛掉 ${screened}）`,
  );
  const next = offset + batchTargets.length;
  if (next < all.length) {
    console.log(`续跑下一批：--offset=${next} --limit=${limit}`);
  } else {
    console.log("全部覆盖股已回填完毕。");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
