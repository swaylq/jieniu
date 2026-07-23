/**
 * 公告「必要摘录」——纯规则、零 AI（省 token 铁律④）。
 *
 * 问题：卡片上的摘要是正文前 128 字截断，而 A 股公告开头**恒定是法定套话**：
 *   「证券代码：600346 证券简称：恒力石化 公告编号：2026-036 恒力石化股份有限公司
 *     关于回购股份事项前十名股东持股信息的公告 本公司董事会及全体董事保证本公告内容
 *     不存在任何虚假记载、误导性陈述或者重大遗漏，并对其内容的真实性、准确性和完整性
 *     承担法律责任。」
 * ——代码/简称/编号在卡片别处已有，公司名与标题重复，剩下的是每篇都一样的免责声明。
 * 结果：卡片看着满，信息量为零，用户「感觉没东西可看」。
 *
 * 这里只做**减法**：剥掉这些恒定样板，返回第一段真正说事的文字。
 * 不改写、不概括、不生成——原文照抄（铁律③数值不失真），只是换个起点。
 */

/** 恒定样板：出现即整体删掉（顺序无关，全局替换）。 */
const BOILERPLATE: RegExp[] = [
  // 证券代码：600346 / 股票代码：600346
  /(?:证券|股票)?代码[:：]\s*[0-9A-Za-z]+/g,
  // 证券简称：恒力石化 / 股票简称：复星医药
  /(?:证券|股票)?简称[:：]\s*[^\s，,。]+/g,
  // 公告编号：临 2026-036 / 编号：临 2026-099（「临」与编号之间常有空格，需一并吃掉）
  /(?:公告)?编号[:：]\s*[临临时]?\s*[0-9A-Za-z]+[-–—]?[0-9A-Za-z]*/g,
  // 释义表头（法律意见书类常见）
  /释\s*义/g,
  /在本(?:法律意见书|报告)中[，,][^。]{0,60}[。.]?/g,
];

/**
 * 「保证真实准确完整」类免责——**按句判定**而非枚举句式。
 * 实测这句有大量变体：或重大遗漏/或者重大遗漏、依法承担/承担、
 * 本公司及董事会全体成员/本公司董事会及全体董事/公司控股股东……
 * 枚举写法必漏，故改为：**整句含「保证」且含真实性字样 ⇒ 整句丢弃**。
 */
function isDisclaimerSentence(sent: string): boolean {
  if (!sent.includes("保证")) return false;
  return /(虚假记载|误导性陈述|重大遗漏|承担法律责任|真实|准确|完整|信息一致)/.test(sent);
}

/** 归一空白：PDF 抽取常带全角空格/多空格/软换行。 */
function squash(s: string): string {
  return s.replace(/[ 　]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 从公告正文提取「必要摘录」。
 * @param title 该条标题（用于剥掉正文里对标题的重复）
 * @param text  正文（无正文时传摘要亦可）
 * @param max   摘录最大字数，默认 120
 */
export function filingExcerpt(title: string, text: string, max = 120): string {
  if (!text) return "";
  let s = squash(text);

  for (const re of BOILERPLATE) s = s.replace(re, " ");

  // 按句丢弃免责声明（保留其余原文，顺序不变）
  s = s
    .split(/(?<=。)/)
    .filter((sent) => !isDisclaimerSentence(sent))
    .join("");

  // 剥掉正文里重复的标题（东财标题常是「公司名:正文标题」，两边都要试）
  const t = squash(title).replace(/^[^:：]{2,12}[:：]/, "");
  if (t.length >= 6) s = s.split(t).join(" ");

  // 剥掉**开头**重复出现的公司全名（公告抬头常把公司名印两遍）。
  // 只锚定开头：若在句中乱删，会把「XX股份有限公司（以下简称“公司”）」削成
  // 悬空的「（以下简称“公司”）」——那是我们自己制造的文本损坏（铁律③原文不失真）。
  const corpHead = /^\s*[一-龥（）()]{2,20}?(?:集团)?(?:股份)?有限公司\s*/;
  for (let i = 0; i < 3; i++) {
    const next = squash(s).replace(corpHead, "");
    if (next === squash(s)) break;
    s = next;
  }

  // 开头若是标题的一个片段（公告正文常把标题原样再印一遍，但可能少了公司名前缀），
  // 逐步缩短匹配长度去掉它——比整串相等更鲁棒。
  const tNo = t.replace(/\s/g, "");
  for (let len = Math.min(40, tNo.length); len >= 8; len--) {
    const head = squash(s).replace(/\s/g, "").slice(0, len);
    if (head.length === len && tNo.includes(head)) {
      // 在原串里按「忽略空白」的方式吃掉这 len 个字
      let taken = 0;
      let i = 0;
      while (i < s.length && taken < len) {
        if (!/\s/.test(s[i]!)) taken++;
        i++;
      }
      s = s.slice(i);
      break;
    }
  }

  s = squash(s);
  // 剥掉公司名后剩下的悬空定义括号残片：「以下简称“公司”）于…」→「于…」
  s = s.replace(/^[（(]?\s*(?:以下)?(?:简称|下称)\s*[“"'']?[^）)]{0,12}[”"'']?\s*[）)]\s*/u, "");
  // 开头残留的标点/连接符
  s = s.replace(/^[\s，,。.、:：;；()（）-]+/, "");

  if (s.length <= max) return s;
  // 尽量断在句末，避免半句
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("；"), cut.lastIndexOf("."));
  return stop >= max * 0.5 ? cut.slice(0, stop + 1) : cut + "…";
}

/** 摘录是否仍然「没说事」（剥完只剩很短/全是标点数字）——此时卡片不如不显示摘录。 */
export function excerptIsEmpty(excerpt: string): boolean {
  const s = excerpt.replace(/[\s，,。.、:：;；()（）\-0-9]/g, "");
  return s.length < 8;
}
