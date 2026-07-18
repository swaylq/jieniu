/**
 * 「问解牛这条」问句构造（P5-6）——把一条资讯标题包成一个**结合用户持仓/逻辑**的问题，
 * 供新闻卡 / 详情页的「问解牛」行动按钮种入全局问解牛面板。纯函数、可测。
 */
const MAX_TITLE = 80;

export function newsAskQuestion(title: string): string {
  const t = title.trim();
  const clipped = t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE)}…` : t;
  return `关于这条消息「${clipped}」，结合我的持仓和投资逻辑，它对我意味着什么？我该注意什么？`;
}
