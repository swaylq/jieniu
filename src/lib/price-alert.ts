// 自定义价位提醒（backlog #3b）的纯逻辑。
// 合规：用户**自设**阈值、只是「到价通知我」——不是解牛的买点/卖点/荐股（铁律②）。
// 相对导入（cron 走 tsx，不解析 ~）。

export type AlertDirection = "above" | "below";

/** 现价是否触发到价提醒：above=现价≥阈值（突破）；below=现价≤阈值（跌破）。无效输入不触发。 */
export function shouldTriggerAlert(
  direction: AlertDirection,
  threshold: number,
  price: number,
): boolean {
  if (
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return false;
  }
  return direction === "above" ? price >= threshold : price <= threshold;
}

/** 到价提醒的中性文案（描述客观条件，不含任何建议）。 */
export function describeAlert(
  direction: AlertDirection,
  threshold: number,
): string {
  const p = threshold.toFixed(2);
  return direction === "above" ? `涨破 ${p} 元时提醒我` : `跌破 ${p} 元时提醒我`;
}

/** 触发后的中性通知文案（陈述已发生的客观事件）。 */
export function triggeredMessage(
  name: string,
  direction: AlertDirection,
  threshold: number,
  price: number,
): string {
  const verb = direction === "above" ? "涨破" : "跌破";
  return `${name} 现价 ${price.toFixed(2)} 元，已${verb}你设的 ${threshold.toFixed(2)} 元`;
}
