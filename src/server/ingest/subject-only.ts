// 「哪些源是 subjectOnly」的单一事实来源。相对导入、无 IO、可测。
//
// 为什么需要这个文件（2026-07-30 run2 发现的漂移）：
// `runner.ts` 对 `def.subjectOnly` 的源**跳过 `isRoundupNews` 等文本启发式**——主体由源权威
// 给出（股票简称+代码），标题里的「龙虎榜 / 大宗交易 / 前N只」是事件体裁自带的词，不是
// 「顺带罗列多股」。可 2026-07-15 写的存量清理脚本 `prune-roundup-bindings.ts` 早于这条豁免，
// 它直接对**所有**已绑定资讯跑 `isRoundupNews`，于是把结构化事件的个股绑定也判成错绑：
// 实测它报「2527 条错误绑定」，逐源拆开看是 龙虎榜 1363 + 大宗交易 1148 + 个股资讯 16 ——
// **99.4% 是该保留的权威绑定**。谁真跑一次 `--apply`，就把 evolution/lessons.md
// 「结构化事件复用既有 ingest 管线会被为综述设计的过滤器误伤」那条教训原样打回去。
//
// 所以豁免名单必须与源定义**同源**，不能在脚本里各抄一份名字：新增结构化源时自动受保护。

import type { SourceDef } from "./types";
import { eastmoneyBillboard } from "./sources/eastmoney-billboard";
import { eastmoneyBlockTrade } from "./sources/eastmoney-blocktrade";
import {
  eastmoneyExecHold,
  eastmoneyShareholderChange,
} from "./sources/eastmoney-holderchange";
import { eastmoneyForecast } from "./sources/eastmoney-forecast";
import { eastmoneyReportsForCodes } from "./sources/eastmoney-report";

/**
 * 全部**静态**源定义里 subjectOnly 的那些。函数构造的源（按代码定向拉取）在下面单独并入——
 * 它们的构造只是返回一个带 fetch 闭包的对象，不发请求，所以拿空参数取 name 是安全的。
 */
const STATIC_DEFS: SourceDef[] = [
  eastmoneyBillboard,
  eastmoneyBlockTrade,
  eastmoneyExecHold,
  eastmoneyShareholderChange,
  eastmoneyForecast,
];

/** 函数构造的源：调一次拿定义（不触发网络），保证 name 与真实入库时一致。 */
function builtDefs(): SourceDef[] {
  const epoch = new Date(0);
  return [eastmoneyReportsForCodes([], epoch, epoch)];
}

/**
 * subjectOnly 源的**入库名**集合（`Source.name`，也就是 `NewsItem.source.name`）。
 * 存量清理脚本要拿它豁免——判据与 runner 完全一致，不是另抄一份。
 */
export function subjectOnlySourceNames(): Set<string> {
  const names = new Set<string>();
  for (const d of [...STATIC_DEFS, ...builtDefs()]) {
    if (d.subjectOnly) names.add(d.name);
  }
  return names;
}

/** 这条资讯的源是不是「主体由源权威给出」——是则不该用标题启发式剥它的个股绑定。 */
export function isSubjectOnlySource(sourceName: string): boolean {
  return subjectOnlySourceNames().has(sourceName);
}
