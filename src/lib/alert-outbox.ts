// 提醒投递层（Alert Outbox）的纯逻辑：把「派生查询」的提醒固化成可寻址、可去重、可标记已投递的事件草稿。
// 相对导入（cron 走 tsx，不解析 ~）。
//
// 合规底线沿用提醒协议：文案 hedged、不含买卖指令 / 目标价 / 收益承诺。
// 通用性：kind / payload 刻意不写死财经语义——这一层以后要整体搬到 hermit 做通用投递。

import { alertReason, type AlertPrefs } from "./alert-protocol";
import { triggeredMessage, type AlertDirection } from "./price-alert";
import { isRoundupNews } from "./relevance";

export type AlertKind = "logic" | "fundamental" | "price";

/** 渠道无关的结构化载荷。收窄到合法 JSON 标量——Prisma 的 Json 输入不接受 `unknown`。 */
export type AlertPayload = Record<string, string | number | boolean | null>;

/** 投递优先级：越大越先投站外。重点维度的逻辑异动最该打断人，重磅资讯最不该。 */
export const PRIORITY = {
  logicPriority: 40,
  logic: 30,
  price: 20,
  fundamental: 10,
} as const;

/** 一次站外投递最多带几条——超出的不丢，在信里写明「另有 N 条在站内」。 */
export const DELIVERY_MAX_ITEMS = 5;

/** 免打扰时段（本地时区）：22:00 起静默，次日 07:30 解除。 */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 7.5;

export type AlertEventDraft = {
  kind: AlertKind;
  dedupeKey: string;
  entityId: string | null;
  title: string;
  body: string;
  url: string | null;
  payload: AlertPayload;
  /** 事实发生时刻（跨越 / 发布 / 触发），排序按它——不按 createdAt，否则回填资讯会整批变成新动态。 */
  occurredAt: Date;
  priority: number;
  /** 是否允许投到站外。false = 只进站内 inbox（复核负反馈的落点）。 */
  offsite: boolean;
};

export type CrossingInput = {
  entityId: string;
  entityName: string;
  dimensionKey: string;
  fromState: string;
  toState: string;
  note: string;
  newsId: string | null;
  newsTitle: string;
  crossedAt: Date;
  /** 用户静音了该维度 */
  muted: boolean;
  /** 用户标为重点维度 */
  priority: boolean;
  /** 上次复核动作是「不相关」——该维度降级为站内 only */
  dismissed: boolean;
  /** 触发这次跨越的信号材料度；取不到为 null（此时**放行**，不因数据缺失吞掉真实变化） */
  materiality: number | null;
  /** 用户为该维度设的敏感度下限（低 80 / 中 60 / 高 40） */
  threshold: number;
};

export type NewsInput = {
  id: string;
  title: string;
  brief: string | null;
  summary: string | null;
  entityId: string | null;
  entityName: string;
  sourceName: string;
  publishedAt: Date;
  /** PRIMARY（一手公告）| MEDIA | DERIVED */
  tier: string;
  importance: number;
  /** 这条资讯一共绑了几个实体——「顺带罗列多股」的综述靠它识别 */
  boundCount: number;
};

/** 能主动打扰人的媒体稿的重要性下限（一手公告不受此限）。站内浏览门槛是 55，推送必须更高。 */
export const PUSH_MIN_IMPORTANCE = 70;
/** 一条推送最多能绑几个实体。2 = 同一家公司的 COMPANY + STOCK；≥3 基本必是综述。 */
export const PUSH_MAX_BOUND_ENTITIES = 2;

/**
 * 「推送前拦一刀」的资讯门槛——**高于**站内浏览门槛（importance≥55）。
 *
 * 实测依据（2026-07-28 首轮生成的 10 条候选）：噪音全长一个样——媒体稿 + 55 分 + 绑 3~7 家公司
 * （「华尔街见闻早餐」绑 7、「月内超600家A股获机构调研」绑 5、「二季度券商股获集中增持」绑 3）；
 * 真·个股事实全是一手公告、绑 2（同一家公司的 COMPANY+STOCK）。
 */
export function isPushWorthyNews(n: {
  title: string;
  tier: string;
  importance: number;
  boundCount: number;
}): boolean {
  if (n.boundCount > PUSH_MAX_BOUND_ENTITIES) return false;
  if (isRoundupNews(n.title, n.boundCount)) return false;
  return n.tier === "PRIMARY" || n.importance >= PUSH_MIN_IMPORTANCE;
}

export type PriceInput = {
  id: string;
  entityId: string;
  entityName: string;
  direction: string;
  threshold: number;
  triggeredPrice: number;
  triggeredAt: Date;
};

const STATE_LABEL: Record<string, string> = {
  bearish: "偏风险",
  bullish: "偏兑现",
  neutral: "中性",
};

function stateLabel(s: string): string {
  return STATE_LABEL[s] ?? "中性";
}

function crossingTitle(c: CrossingInput): string {
  const to = stateLabel(c.toState);
  const verb = c.toState === "neutral" ? "回到" : "转向";
  return `${c.entityName}「${c.dimensionKey}」${verb}${to}`;
}

function crossingBody(c: CrossingInput): string {
  const reason = alertReason({ toState: c.toState, dimensionKey: c.dimensionKey });
  const evidence = c.newsTitle ? `\n\n触发依据：${c.newsTitle}` : "";
  const note = c.note ? `\n${c.note}` : "";
  return `${reason}${note}${evidence}`;
}

/**
 * 生成事件草稿。前三道闸在这里：分类开关（不生成）、维度静音（不生成）、复核负反馈（生成但 offsite=false）。
 * 输出已排好投递顺序：优先级降序 → 事实发生时刻降序。
 */
export function buildAlertEvents(input: {
  crossings: CrossingInput[];
  news: NewsInput[];
  priceAlerts: PriceInput[];
  prefs: AlertPrefs;
}): AlertEventDraft[] {
  const out: AlertEventDraft[] = [];

  if (input.prefs.logic) {
    for (const c of input.crossings) {
      if (c.muted) continue; // 闸二：静音的维度连站内都不进
      // 闸二·b：敏感度——低于你为该维度设的材料度下限就不提醒。
      // 材料度取不到时放行：数据缺失不该等同于「不重要」。
      if (c.materiality !== null && c.materiality < c.threshold) continue;
      out.push({
        kind: "logic",
        dedupeKey: `logic:${c.entityId}:${c.dimensionKey}:${c.crossedAt.toISOString()}`,
        entityId: c.entityId,
        title: crossingTitle(c),
        body: crossingBody(c),
        url: `/entity/${c.entityId}`,
        payload: {
          entityName: c.entityName,
          dimensionKey: c.dimensionKey,
          fromState: c.fromState,
          toState: c.toState,
          newsId: c.newsId,
          newsTitle: c.newsTitle,
        },
        occurredAt: c.crossedAt,
        priority: c.priority ? PRIORITY.logicPriority : PRIORITY.logic,
        offsite: !c.dismissed, // 闸三：判过「不相关」的维度只留站内
      });
    }
  }

  if (input.prefs.price) {
    for (const p of input.priceAlerts) {
      out.push({
        kind: "price",
        dedupeKey: `price:${p.id}`,
        entityId: p.entityId,
        title: triggeredMessage(
          p.entityName,
          p.direction as AlertDirection,
          p.threshold,
          p.triggeredPrice,
        ),
        body: "你设的观察位，非荐买卖——到价只是事实陈述，是否行动由你判断。",
        url: `/entity/${p.entityId}`,
        payload: {
          entityName: p.entityName,
          direction: p.direction,
          threshold: p.threshold,
          triggeredPrice: p.triggeredPrice,
        },
        occurredAt: p.triggeredAt,
        priority: PRIORITY.price,
        offsite: true,
      });
    }
  }

  if (input.prefs.fundamental) {
    // 同公司一轮只推一条：跨源重复（同一次回购既有公告又有快讯）与程序性文档轰炸都从这里收口，
    // 沿用早报 collapseDigestItems 的 perCompany=1 思路。输入已按发布时间倒序，留下的是最新那条。
    const seenCompany = new Set<string>();
    for (const n of input.news) {
      if (!isPushWorthyNews(n)) continue;
      const key = n.entityId ?? `title:${n.title}`;
      if (seenCompany.has(key)) continue;
      seenCompany.add(key);
      out.push({
        kind: "fundamental",
        dedupeKey: `news:${n.id}`,
        entityId: n.entityId,
        title: n.title,
        body: n.brief ?? n.summary ?? "",
        url: `/news/${n.id}`,
        payload: { entityName: n.entityName, sourceName: n.sourceName },
        occurredAt: n.publishedAt,
        priority: PRIORITY.fundamental,
        offsite: true,
      });
    }
  }

  return out.sort(
    (a, b) =>
      b.priority - a.priority || b.occurredAt.getTime() - a.occurredAt.getTime(),
  );
}

/**
 * 闸四：一次站外投递取前 DELIVERY_MAX_ITEMS 条。
 * 被挤下去的进 heldBack 由调用方在信里写明——**不静默截断**（截断读起来像「就这么多」）。
 * offsite=false 的本就只属于站内，不算被挤下去。
 */
export function selectForDelivery<
  T extends { priority: number; occurredAt: Date; offsite: boolean },
>(events: T[], max = DELIVERY_MAX_ITEMS): { deliver: T[]; heldBack: number } {
  const candidates = events
    .filter((e) => e.offsite)
    .sort(
      (a, b) =>
        b.priority - a.priority || b.occurredAt.getTime() - a.occurredAt.getTime(),
    );
  return {
    deliver: candidates.slice(0, max),
    heldBack: Math.max(0, candidates.length - max),
  };
}

/** 闸五：本地时间是否落在免打扰时段内。cron 时点已避开，这里是双保险。 */
export function withinQuietHours(now: Date): boolean {
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}
