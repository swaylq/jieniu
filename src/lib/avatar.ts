import { AVATAR_GRADIENTS, avatarGradient, avatarInitial } from "./brand";

/**
 * 头像的纯逻辑层 —— 优先级判定、输入归一、裁剪几何。
 *
 * 全是纯函数，服务端（tRPC 校验、SSR 渲染）与客户端（编辑器实时预览、出图）共用同一套，
 * 这样「预览看到的」和「最终存下的」不可能对不上。
 */

/** 显示字符上限（按**字素**算，不是 code unit）。两个字够放「张楚」「AB」，再多就挤了。 */
export const AVATAR_CHAR_MAX = 2;

/** 用户在库里的头像设置。字段名与 Prisma `User` 对齐，便于直接把查询结果丢进来。 */
export type AvatarPrefs = {
  /** 上传照片的 URL；null / 空串 = 没传过。 */
  image: string | null | undefined;
  /** `AVATAR_GRADIENTS` 下标；null = 按 seed 散列。 */
  avatarColor: number | null | undefined;
  /** 自定义显示字符；null = 用 seed 首字母。 */
  avatarChar: string | null | undefined;
};

export type ResolvedAvatar =
  | { kind: "image"; src: string }
  | { kind: "glyph"; from: string; to: string; text: string };

/**
 * 优先级：**照片 > 文字头像 > 散列默认**。
 *
 * 照片优先但不清掉 color/char —— 用户删掉照片后，之前调好的文字头像还在，不用重设一遍。
 */
export function resolveAvatar(
  prefs: AvatarPrefs,
  seed: string | null | undefined,
): ResolvedAvatar {
  const src = (prefs.image ?? "").trim();
  if (src) return { kind: "image", src };

  const color = clampColorIndex(prefs.avatarColor);
  const [from, to] =
    color === null ? avatarGradient(seed ?? "解牛") : AVATAR_GRADIENTS[color]!;
  const text = normalizeAvatarChar(prefs.avatarChar) ?? avatarInitial(seed);
  return { kind: "glyph", from, to, text };
}

/**
 * 归一显示字符：剔掉空白与控制字符 → 按**字素**取前 `AVATAR_CHAR_MAX` 个 → 空则 null。
 *
 * 为什么必须按字素：`"🐂".length === 2`，`slice(0, 2)` 会把代理对切成两半（渲染成 ▯▯）；
 * 而 `👨‍👩‍👧` 由 ZWJ 连接的 5 个码点组成，按码点数也不对。`Intl.Segmenter` 才是正确的尺子。
 */
export function normalizeAvatarChar(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  // 空白（含全角空格 / BOM）与 C0/C1 控制字符一律剔除——它们会把圆盘里的字顶歪。
  const cleaned = raw.replace(/[\s\u0000-\u001F\u007F-\u009F]/gu, "");
  if (!cleaned) return null;
  return graphemes(cleaned).slice(0, AVATAR_CHAR_MAX).join("");
}

/** 拆字素。`Intl.Segmenter` 不可用时退回码点切分（至少不会切碎代理对）。 */
function graphemes(s: string): string[] {
  const Seg = (
    Intl as unknown as { Segmenter?: typeof Intl.Segmenter }
  ).Segmenter;
  if (typeof Seg !== "function") return Array.from(s);
  const seg = new Seg("zh", { granularity: "grapheme" });
  return Array.from(seg.segment(s), (x) => x.segment);
}

/** 色号白名单：越界 / 非整数 / 空 一律 null（回落散列取色），绝不抛。 */
export function clampColorIndex(n: number | null | undefined): number | null {
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  if (n < 0 || n >= AVATAR_GRADIENTS.length) return null;
  return n;
}

/**
 * 上传头像的相对 URL。带内容版本号 `?v=` —— 换了头像 URL 就变，于是响应可以标 `immutable`，
 * 浏览器永久缓存也永远不会显示旧图。
 */
export function avatarUrl(userId: string, version: string): string {
  return `/api/avatar/${userId}?v=${version}`;
}

/** cuid 形状白名单。拼文件路径前必过这一关——`..`、`/`、`.` 全部挡在外面。 */
export function isUserIdLike(id: string | null | undefined): boolean {
  return typeof id === "string" && /^[a-z0-9]{20,32}$/i.test(id);
}

export type CropInput = {
  /** 原图的自然像素尺寸。 */
  naturalW: number;
  naturalH: number;
  /** 取景框边长（CSS px），预览与出图共用。 */
  viewport: number;
  /** 缩放倍数，1 = 恰好填满取景框（cover）。 */
  zoom: number;
  /** 图心相对取景框心的平移（CSS px）。往右 / 往下为正。 */
  tx: number;
  ty: number;
};

/** 源图上的正方形取景矩形，直接喂 `canvas.drawImage(img, sx, sy, size, size, …)`。 */
export type CropRect = { sx: number; sy: number; size: number };

/**
 * 由预览的「缩放 + 平移」反算源图取景矩形。
 *
 * 推导：`baseScale = viewport / 短边`（zoom=1 即 cover），实际缩放 `k = baseScale * zoom`，
 * 故取景框边长换算到源图是 `viewport / k = 短边 / zoom`；平移 `tx`(CSS px) 换算到源图是
 * `tx / k`，方向相反（图往右挪 = 取景往左挪）。
 *
 * 两处夹紧保证**取景框永远被图填满**（不会取到图外留黑边）：边长不超过短边；
 * 左上角落在 `[0, 自然边长 - 边长]` 内。
 */
export function cropSourceRect(input: CropInput): CropRect {
  const nw = Math.max(0, input.naturalW);
  const nh = Math.max(0, input.naturalH);
  const minSide = Math.max(1, Math.min(nw, nh));
  const viewport = Math.max(1, input.viewport);
  const zoom = Math.max(0.01, input.zoom);

  // 用 `短边 / zoom` 而不是 `viewport / k`：数学等价，但少一次除法往返，整数缩放下结果精确。
  const size = Math.min(minSide / zoom, minSide);
  const pxToSource = minSide / (viewport * zoom);

  const sx = clamp((nw - size) / 2 - input.tx * pxToSource, 0, nw - size);
  const sy = clamp((nh - size) / 2 - input.ty * pxToSource, 0, nh - size);

  const rSize = Math.max(1, Math.round(size));
  return {
    sx: clamp(Math.round(sx), 0, Math.max(0, nw - rSize)),
    sy: clamp(Math.round(sy), 0, Math.max(0, nh - rSize)),
    size: rSize,
  };
}

/** 上界小于下界时（退化尺寸）返回下界，别返回 NaN。 */
function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  if (hi <= lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}
