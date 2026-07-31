/**
 * 证据合并（纯函数、无 IO、可测）。
 *
 * 放在 `lib/` 而不是路由文件里：路由会拉起 `~/server/api/trpc` → next-auth，
 * 在 vitest 里根本 import 不进来（实测 `Cannot find module 'next/server'`）。
 * 判断逻辑一律留在 lib，路由只做取数与拼装。
 */

import type { ExtraEvidence } from "./commodity";

export type EvidenceItem = {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: Date;
  /** true = 站外原文（商品行情页），链接直接外跳而不是走 /news/<id> */
  external: boolean;
};

export type NewsLite = {
  id: string;
  title: string;
  url: string;
  publishedAt: Date;
  source: { name: string };
};

/**
 * 站内资讯 + 自带链接的证据合并成前台用的一份。
 *
 * 两件事必须在这里做对：
 *  ① 查不到的站内 id **丢掉**（资讯被清理过），不能渲染成空条目；
 *  ② 站外证据打 `external`，前台据此外跳——它没有站内 NewsItem，
 *     链到 `/news/<合成id>` 会 404。
 */
export function mergeEvidence(
  newsIds: string[],
  newsById: Map<string, NewsLite>,
  extra: ExtraEvidence[] | null,
): EvidenceItem[] {
  return [
    ...newsIds
      .map((id) => newsById.get(id))
      .filter((n): n is NewsLite => !!n)
      .map((n) => ({
        id: n.id,
        title: n.title,
        url: n.url,
        sourceName: n.source.name,
        publishedAt: n.publishedAt,
        external: false,
      })),
    ...(extra ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      url: e.url,
      sourceName: e.sourceName,
      publishedAt: new Date(`${e.publishedAt}T00:00:00.000Z`),
      external: true,
    })),
  ];
}

