import { PrismaClient } from "../../generated/prisma";
import { keepQualified, gradeLabel } from "../lib/evidence";

/**
 * 存量「最新证据」体检（张楚寒 2026-07-30 反馈）。**只读，不写库。**
 *
 * 单测夹具是我自己写的，证明不了判据对真实数据有效（见 lessons.md「类型声明不是事实」）。
 * 这个脚本把 `judgeEvidence` 指向真库全部 ThesisSignal，报三个数：留下多少 / 判废多少 /
 * 各因为什么，并把两边各抽若干条打出来**逐条肉眼复核**——复核的重点是**被挡掉的那一堆**
 * （留下的那些我看两遍都会觉得挺好，问题全在挡掉的里面）。
 *
 * 用法：
 *   DATABASE_URL="postgresql://mac@localhost:5432/jieniu" SKIP_ENV_VALIDATION=1 \
 *     npx tsx src/scripts/audit-evidence.ts [--show=20]
 */
const db = new PrismaClient();

function argNum(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) || dflt : dflt;
}

async function main() {
  const show = argNum("show", 12);
  const rows = await db.thesisSignal.findMany({
    orderBy: { publishedAt: "desc" },
    select: {
      dimensionKey: true,
      note: true,
      newsTitle: true,
      materiality: true,
      direction: true,
      entity: { select: { name: true } },
      news: { select: { tier: true } },
    },
  });

  const items = rows.map((r) => ({
    fact: r.note,
    why: "",
    dimensionKey: r.dimensionKey,
    subject: r.entity.name,
    newsTitle: r.newsTitle,
    tier: r.news.tier,
    _raw: r,
  }));

  const { kept, dropped } = keepQualified(items);
  const byReason = new Map<string, number>();
  for (const d of dropped) {
    const k = d.verdict.reason.split("——")[0]!.split("（")[0]!;
    byReason.set(k, (byReason.get(k) ?? 0) + 1);
  }
  const byGrade = new Map<string, number>();
  for (const k of kept) {
    byGrade.set(k.verdict.grade, (byGrade.get(k.verdict.grade) ?? 0) + 1);
  }

  console.log(`存量 ThesisSignal：${rows.length} 条`);
  console.log(
    `  合格 ${kept.length} 条（${((kept.length / rows.length) * 100).toFixed(1)}%）` +
      ` — ${[...byGrade].map(([g, n]) => `${gradeLabel(g as never)} ${n}`).join(" / ")}`,
  );
  console.log(`  判废 ${dropped.length} 条，按原因：`);
  for (const [r, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${r}`);
  }

  console.log(`\n—— 判废样本（复核重点：有没有误杀真证据）——`);
  for (const d of dropped.slice(0, show)) {
    console.log(`  ✗ [${d.item.dimensionKey}] ${d.item.fact}`);
    console.log(`     因为：${d.verdict.reason}`);
  }

  console.log(`\n—— 留下的样本 ——`);
  for (const k of kept.slice(0, show)) {
    console.log(
      `  ✓ [${k.item.dimensionKey}·${gradeLabel(k.verdict.grade)}] ${k.item.fact}`,
    );
  }

  // 覆盖面：判废后有多少实体一条证据都不剩（这是「宁可留空」的代价，要看得见）
  const byEntity = new Map<string, { total: number; kept: number }>();
  for (const it of items) {
    const e = byEntity.get(it.subject) ?? { total: 0, kept: 0 };
    e.total++;
    byEntity.set(it.subject, e);
  }
  for (const k of kept) {
    byEntity.get(k.item.subject)!.kept++;
  }
  const empty = [...byEntity].filter(([, v]) => v.kept === 0);
  console.log(
    `\n覆盖面：${byEntity.size} 家有信号，判废后 ${empty.length} 家一条证据都不剩` +
      `（${empty.slice(0, 8).map(([n]) => n).join("、")}${empty.length > 8 ? "…" : ""}）`,
  );

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await db.$disconnect();
});
