/**
 * 全局「问解牛」种子入口（P5-6）——一个极简模块级单例，让任意组件（如新闻卡的「问解牛」按钮）
 * 打开常驻的问解牛面板并带入一个问题。`AskJieniu` 挂载时注册 handler；未登录时 AskJieniu 不挂载，
 * `emitAsk` 返回 false，调用方据此跳登录。纯模块状态、可测（register/emit/has 不依赖 window）。
 */
/**
 * 提问时的现场（2026-08-04）。原来只传一个问题字符串，于是「问解牛这条」把标题拼进问题里、
 * **把正文丢了**——而用户要的答案常常就在那段正文里（实测麒盛科技那条业绩预告，
 * 摘要原文写着「主要系受美元汇率波动影响，本报告期汇兑损失增加」，系统却答不出来）。
 * 现在把 newsId / entityId 一起带上，后端据此取原文。
 */
export type AskContextRef = { newsId?: string; entityId?: string };

type AskHandler = (question: string, ref?: AskContextRef) => void;

let handler: AskHandler | null = null;

/** AskJieniu 挂载时注册；返回注销函数（卸载时调用）。 */
export function registerAskHandler(h: AskHandler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/** 是否已有问解牛面板可用（= 用户已登录且面板已挂载）。 */
export function hasAskHandler(): boolean {
  return handler !== null;
}

/** 带问题打开问解牛面板；无 handler（未登录）返回 false，由调用方处理（跳登录）。 */
export function emitAsk(question: string, ref?: AskContextRef): boolean {
  if (handler) {
    handler(question, ref);
    return true;
  }
  return false;
}
