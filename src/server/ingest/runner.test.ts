import { describe, it, expect, vi, type Mock } from "vitest";
import type { RawNewsItem, SourceDef } from "./types";
import type { EntityDictEntry } from "../../lib/entity-tagging";
import { ingestSource } from "./runner";
import { newsHash } from "./hash";

function makeSource(items: RawNewsItem[]): SourceDef {
  return {
    key: "test-src",
    name: "测试源",
    tier: "MEDIA",
    kind: "json-api",
    async fetch() {
      return items;
    },
  };
}

type FindManyArgs = {
  where?: { hash?: { in?: string[] } };
  select?: { id?: boolean };
};

function makeDb(over: {
  entities?: EntityDictEntry[];
  newsItemFindMany?: ReturnType<typeof vi.fn>;
  newsItemCreateMany?: ReturnType<typeof vi.fn>;
} = {}) {
  const newsItemCreateMany =
    over.newsItemCreateMany ??
    vi.fn().mockImplementation(({ data }: { data: unknown[] }) =>
      Promise.resolve({ count: data.length }),
    );
  const newsEntityCreateMany = vi.fn().mockResolvedValue({ count: 0 });
  const newsItemFindMany =
    over.newsItemFindMany ??
    vi.fn().mockImplementation((args: FindManyArgs) => {
      if (args.where?.hash?.in) {
        // 带 select.id 的是 createMany 后的反查（返回 id+hash）；
        // 只 select.hash 的是攒批预滤（库内已存在 → 空）。
        if (args.select?.id) {
          return Promise.resolve(
            args.where.hash.in.map((h, i) => ({ id: `n${i}`, hash: h })),
          );
        }
        return Promise.resolve([]);
      }
      return Promise.resolve([]); // 近 7 天判重窗口
    });
  const db = {
    source: { upsert: vi.fn().mockResolvedValue({ id: "src1" }) },
    entity: {
      findMany: vi.fn().mockResolvedValue(over.entities ?? []),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    entityRelation: { findMany: vi.fn().mockResolvedValue([]) },
    newsItem: {
      findMany: newsItemFindMany,
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: newsItemCreateMany,
    },
    newsEntity: { createMany: newsEntityCreateMany },
  };
  return {
    db,
    newsItemCreateMany,
    newsEntityCreateMany,
    newsItemFindUnique: db.newsItem.findUnique,
    newsItemCreate: db.newsItem.create,
  };
}

/** mock 调用的第一参数（createMany 的 args），断言成 `{ data }` 让 lint 不炸 any。 */
function callData(mock: { mock: { calls: unknown[][] } }, i = 0): { data: unknown[] } {
  return mock.mock.calls[i]![0] as { data: unknown[] };
}

const DT = new Date("2026-08-07T03:00:00+08:00");

function item(externalId: string, title: string): RawNewsItem {
  return {
    externalId,
    title,
    url: `https://a.com/${externalId}`,
    summary: `${title} 摘要`,
    publishedAt: DT,
  };
}

describe("ingestSource 攒批入库", () => {
  it("不再逐条 findUnique+create；批量 createMany 并反查 id 挂实体", async () => {
    const dict: EntityDictEntry[] = [
      {
        id: "e1",
        type: "STOCK",
        name: "宁德时代(300750)",
        shortName: "宁德时代",
        aliases: [],
        ticker: "300750",
      },
    ];
    const {
      db,
      newsItemCreateMany,
      newsEntityCreateMany,
      newsItemFindUnique,
      newsItemCreate,
    } = makeDb({ entities: dict });
    const r = await ingestSource(
      db as never,
      makeSource([item("e1", "宁德时代发布麒麟电池"), item("e2", "比亚迪发布新车型")]),
    );

    expect(r.inserted).toBe(2);
    expect(r.tagged).toBe(1); // 只有宁德时代那条绑到实体
    expect(r.skipped).toBe(0);
    expect(r.failed).toBe(0);
    expect(newsItemFindUnique).not.toHaveBeenCalled();
    expect(newsItemCreate).not.toHaveBeenCalled();
    expect(newsItemCreateMany).toHaveBeenCalledTimes(1);
    expect(callData(newsItemCreateMany).data).toHaveLength(2);
    // createMany 数据里不带 entities 嵌套（实体走 newsEntity.createMany）
    expect(callData(newsItemCreateMany).data[0]).not.toHaveProperty(
      "entities",
    );
    expect(newsEntityCreateMany).toHaveBeenCalledTimes(1);
    expect(callData(newsEntityCreateMany).data).toEqual([
      { newsId: "n0", entityId: "e1" },
    ]);
  });

  it("同批内 hash 重复不报错，按 createMany 跳过数计 skipped", async () => {
    const { db, newsItemCreateMany } = makeDb();
    // 模拟 skipDuplicates：3 条里只有 2 条真正建成。
    newsItemCreateMany.mockResolvedValue({ count: 2 });
    const r = await ingestSource(
      db as never,
      makeSource([
        item("e1", "宁德时代发布麒麟电池"),
        item("e2", "比亚迪发布新车型"),
        item("e3", "茅台三季度营收增长"),
      ]),
    );
    expect(r.inserted).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);
  });

  it("库内已有 hash 的条目在攒批前被滤掉", async () => {
    const existing = newsHash("test-src", "e1", "宁德时代发布麒麟电池");
    const { db, newsItemCreateMany } = makeDb({
      newsItemFindMany: vi.fn().mockImplementation((args: FindManyArgs) => {
        if (args.where?.hash?.in) {
          if (args.select?.id) {
            return Promise.resolve(
              args.where.hash.in.map((h, i) => ({ id: `n${i}`, hash: h })),
            );
          }
          return Promise.resolve(
            args.where.hash.in
              .filter((h) => h === existing)
              .map((h) => ({ hash: h })),
          );
        }
        return Promise.resolve([]);
      }),
    });
    const r = await ingestSource(
      db as never,
      makeSource([item("e1", "宁德时代发布麒麟电池"), item("e2", "比亚迪发布新车型")]),
    );
    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(1);
    expect(callData(newsItemCreateMany).data).toHaveLength(1);
  });

  it("同批内同标题只入一条，其余计 skipped", async () => {
    const { db } = makeDb();
    const r = await ingestSource(
      db as never,
      makeSource([item("e1", "宁德时代发布麒麟电池"), item("e2", "宁德时代发布麒麟电池")]),
    );
    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it("超过 BATCH_SIZE(200) 时按批写入", async () => {
    const { db, newsItemCreateMany } = makeDb();
    const many = Array.from({ length: 205 }, (_, i) =>
      item(`e${i}`, `测试新闻${i}条`),
    );
    await ingestSource(db as never, makeSource(many));
    expect(newsItemCreateMany).toHaveBeenCalledTimes(2);
    expect(callData(newsItemCreateMany).data).toHaveLength(200);
    expect(callData(newsItemCreateMany, 1).data).toHaveLength(5);
  });
});
