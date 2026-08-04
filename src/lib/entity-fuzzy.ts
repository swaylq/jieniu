// 公司名的**一字之差**容错（2026-08-04，张楚寒的现场）。相对导入、无 IO、可测。
//
// 现场：她在问解牛里打「**麟**盛科技半年报表现梳理」，而公司叫「**麒**盛科技」——差一个字。
// 实体识别是精确子串匹配，于是一个字都没认出来，回答退回成泛泛的框架建议。
// 同一句话把字打对，答案完整且带出处（实测同一账号、同一时刻验证过）。
//
// 中文输入法选错字是**常态**（麒/麟 都是鹿字旁，「麒麟」还是个常用词），
// 而这条路径的输入是用户自由打的字，不是我们自己的语料——入库端的严格匹配在这里就变成了脆弱。
//
// 判据刻意保守，宁可不猜：
//   · **只在精确匹配一个都没有时才启用**——名字打对了永远走精确那条路；
//   · 只认长度 ≥3 的名字：两字名之间一字之差太常见（美的 / 美光 是两家真公司）；
//   · 编辑距离 ≤1（替换 / 多字 / 少字都算）；
//   · **命中多于一个就不猜**，交给调用方去问用户是哪一只——猜错比不猜更糟。

import type { EntityDictEntry } from "./entity-tagging";

export type FuzzyHit = {
  id: string;
  /** 词典里的正式名 */
  name: string;
  /** 用户实际打的那几个字 */
  typed: string;
};

/** 名字最短几个字才允许模糊匹配。两字名之间差一个字往往是另一家真公司。 */
const MIN_LEN = 3;
const MAX_LEN = 8;

/** 编辑距离是否 ≤1（含替换/插入/删除）。短字符串直接算，不做 DP 表。 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false; // 完全一样属于精确匹配，不归这里管
  const d = a.length - b.length;
  if (d > 1 || d < -1) return false;
  if (d === 0) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++diff > 1) return false;
    }
    return diff === 1;
  }
  // 长度差 1：短的那个是长的删掉一个字
  const [lo, hi] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < lo.length && j < hi.length) {
    if (lo[i] === hi[j]) {
      i++;
      j++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

function bareName(name: string): string {
  return name.replace(/[（(][^（()）]*[)）]\s*$/, "").trim();
}

/** 文本里的中文片段——英文/数字不做模糊（代码打错一位是另一只股，不能猜）。 */
function cjkRuns(text: string): string[] {
  return text.match(/[一-鿿]+/g) ?? [];
}

/**
 * 在文本里找「跟某个公司名只差一个字」的片段。
 * 只该在**精确匹配零命中**时调用；`limit` 按**公司名**算，不按实体条数。
 */
export function fuzzyMatchEntities(
  text: string,
  dict: EntityDictEntry[],
  limit = 3,
): FuzzyHit[] {
  const runs = cjkRuns(text);
  if (runs.length === 0) return [];

  // 按长度分桶，只跟同长与±1 长的窗口比
  const byLen = new Map<number, { id: string; name: string }[]>();
  for (const e of dict) {
    if (e.type !== "COMPANY" && e.type !== "STOCK") continue;
    for (const raw of [bareName(e.name), e.shortName ?? "", ...(e.aliases ?? [])]) {
      const n = raw.trim();
      if (n.length < MIN_LEN || n.length > MAX_LEN) continue;
      if (!/^[一-鿿]+$/.test(n)) continue;
      const arr = byLen.get(n.length) ?? [];
      if (!arr.some((x) => x.id === e.id && x.name === n)) arr.push({ id: e.id, name: n });
      byLen.set(n.length, arr);
    }
  }

  const hits: FuzzyHit[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    // **从长窗口往短窗口找**：同一家公司会被多个窗口命中（「麟盛科技」是替换、「盛科技」是少一字），
    // 长的那个才是用户真正打的东西。先短后长会把 typed 记成「盛科技」，回显给用户就很怪。
    for (let len = Math.min(MAX_LEN, run.length); len >= MIN_LEN; len--) {
      for (let i = 0; i + len <= run.length; i++) {
        const win = run.slice(i, i + len);
        for (const cand of [
          ...(byLen.get(len) ?? []),
          ...(byLen.get(len + 1) ?? []),
        ]) {
          // 这个名字在原文里本来就完整出现过 → 那是精确匹配的活，模糊别插手
          // （否则「麒盛科技半年报」里的「盛科技」窗口又会把它当成打错字）
          if (text.includes(cand.name)) continue;
          if (!withinOneEdit(win, cand.name)) continue;
          if (seen.has(cand.id)) continue;
          // **按公司名算配额，不按实体条数**。同一家公司有 COMPANY + STOCK 两个实体，
          // 直接对 hits 截断会被孪生实体吃掉名额——实测「麟盛科技」返回了凯盛科技/隆盛科技，
          // 而真正要找的麒盛科技被挤掉了，用户看到的候选里根本没有他要的那家。
          const names = distinctCompanies(hits);
          if (!names.includes(cand.name) && names.length >= limit) continue;
          seen.add(cand.id);
          hits.push({ id: cand.id, name: cand.name, typed: win });
        }
      }
    }
  }
  return hits;
}

/** 按公司归并：同一家公司的孪生实体/别名只算一个候选。 */
export function distinctCompanies(hits: FuzzyHit[]): string[] {
  const out: string[] = [];
  for (const h of hits) if (!out.includes(h.name)) out.push(h.name);
  return out;
}
