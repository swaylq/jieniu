import { describe, it, expect, vi } from "vitest";

import { hotStockTargets, targetsByNeed } from "./backfill-targets";

// 2026-07-30 实测事故：`targetsByNeed` 按 bound 升序返回全部 5500 只，而 81 只**退市死壳**
// 恒为 bound=0，稳定占据队头。所有调用方都是 `.slice(0, N)`（ingest 的研报/媒体刷新、
// backfill-announcements / -reports / -media / -year 共五条路径），于是每轮都在捞同一批死壳，
// 自 7-26 起 100% 空转。判据不能用名字（「玉龙股份」「广汽长丰」「太行水泥」都是死壳但不含「退/ST」，
// 队头 40 只里名字判据只覆盖 31 只），要用**有没有资金流信号**——它每天刷新，覆盖队头 40/40。
describe("targetsByNeed · 退市死壳不许锁死队头", () => {
  /**
   * 四只股，覆盖四种情形：
   * - sA 在交易、有大量陈年绑定 → 活，但不缺料，排后面
   * - sB 在交易、零绑定（新股）→ 活，**最缺料，应在队头**
   * - sC 无资金流、只有陈年绑定（中国北车那类吸并退市股）→ **死，必须剔除**
   * - sD 非 A 股六位代码（美股 NVDA，压根不在 A 股资金流快照里）→ 活，保留
   */
  function makeDb(opts: {
    flowFor: string[];
    filingFor?: string[];
    watchedFor?: string[];
  }) {
    const ALL = [
      { entityId: "sA", _count: { entityId: 7 } },
      { entityId: "cA", _count: { entityId: 3 } },
      { entityId: "sC", _count: { entityId: 4 } }, // 陈年绑定，不足以证明活着
      // sB / sD 零绑定
    ];
    return {
      watchlist: {
        findMany: vi
          .fn()
          .mockResolvedValue((opts.watchedFor ?? []).map((entityId) => ({ entityId }))),
      },
      entity: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sA", name: "甲公司(600001)", ticker: "600001" },
          { id: "sB", name: "新上市(600002)", ticker: "600002" },
          { id: "sC", name: "中国北车(600003)", ticker: "600003" },
          { id: "sD", name: "英伟达(NVDA)", ticker: "NVDA" },
        ]),
      },
      entityRelation: {
        findMany: vi.fn().mockResolvedValue([{ fromId: "cA", toId: "sA" }]),
      },
      // groupBy 被调两次：不带 where 的是「全历史绑定数」，带 where 的是「近 30 天一手公告」
      newsEntity: {
        groupBy: vi.fn().mockImplementation((args: { where?: unknown }) =>
          Promise.resolve(
            args?.where
              ? (opts.filingFor ?? []).map((entityId) => ({ entityId, _count: { entityId: 1 } }))
              : ALL,
          ),
        ),
      },
      entitySignal: {
        findMany: vi
          .fn()
          .mockResolvedValue(opts.flowFor.map((entityId) => ({ entityId }))),
      },
    } as never;
  }

  it("陈年绑定不算活着——吸并退市股被剔除，零资讯但在交易的新股留在队头", async () => {
    const res = await targetsByNeed(makeDb({ flowFor: ["sA", "sB"] }));
    const codes = res.map((t) => t.code);
    expect(codes).not.toContain("600003"); // sC：4 条陈年误绑 + 无资金流 → 死
    expect(codes[0]).toBe("600002"); // 零绑定的在交易新股排队头
    expect(codes.indexOf("600002")).toBeLessThan(codes.indexOf("600001"));
  });

  it("非 A 股六位代码的实体（美股）不需要资金流就算活——它们不在 A 股快照里", async () => {
    const res = await targetsByNeed(makeDb({ flowFor: ["sA"] }));
    expect(res.map((t) => t.code)).toContain("NVDA");
    expect(res.map((t) => t.code)).not.toContain("600002"); // sB 是 A 股代码且无资金流
  });

  it("「近期有资讯」不能当活着的证据——那个信号被死壳的误绑污染了", async () => {
    // sC 有 4 条陈年绑定（实测全是误绑：「美的电器」←「南疆中亚家博城奠基」那一类），
    // 只要它没有资金流，就必须判死。
    const res = await targetsByNeed(makeDb({ flowFor: ["sA", "sB"] }));
    expect(res.map((t) => t.code)).not.toContain("600003");
  });

  it("死壳一旦重新有资金流（恢复上市）自动回到队头——判据是动态的，不是黑名单", async () => {
    const res = await targetsByNeed(makeDb({ flowFor: ["sA", "sB", "sC"] }));
    expect(res.map((t) => t.code)).toContain("600003");
  });

  // run5：待上市新股不在资金流快照里（要等上市日才有行情），但在发「首次公开发行股票注册的批复」
  // 这类一手公告。实测被误判成死壳的有 嘉立创(001232) 展芯股份(301707) 聚仁新材(920258) 等。
  it("待上市新股靠一手公告算活——它还没交易，但在发 IPO 公告", async () => {
    const res = await targetsByNeed(makeDb({ flowFor: ["sA"], filingFor: ["sB"] }));
    expect(res.map((t) => t.code)).toContain("600002"); // sB 无资金流，但近 30 天有公告
    expect(res.map((t) => t.code)).not.toContain("600003"); // sC 两者皆无 → 仍是死壳
  });

  it("一手公告只认公告源，不是「近期有任何资讯」——后者被死壳的误绑污染", async () => {
    // sC 有 4 条陈年媒体绑定但没有公告 → 仍判死；这正是被否决的那条判据与本条的分界
    const res = await targetsByNeed(makeDb({ flowFor: [], filingFor: [] }));
    expect(res.map((t) => t.code)).toEqual(["NVDA"]);
  });

  // 2026-08-02 复盘：20 只被自选的股跟 5500 只陌生股平等排队，轮一圈 8–10 天
  // （万向钱潮 10 天、大普微/国盾量子 9 天没有新资讯），而用户看到的就是「今日静音」。
  // 信号层（backfill-signals）早就按 Watchlist 排序了，资讯层没有——两条管线口径不一致。
  it("被自选的股排在队头——哪怕它一点都不缺料", async () => {
    // sA 有 10 条绑定（最不缺料），但有人盯着；sB 零绑定
    const res = await targetsByNeed(
      makeDb({ flowFor: ["sA", "sB"], watchedFor: ["sA"] }),
    );
    expect(res[0]!.code).toBe("600001");
    expect(res[0]!.watched).toBe(true);
    expect(res[1]!.code).toBe("600002"); // 其余仍按缺料程度排
  });

  it("自选认公司那份实体——自选存 COMPANY、抓取按 STOCK 走", async () => {
    const res = await targetsByNeed(
      makeDb({ flowFor: ["sA", "sB"], watchedFor: ["cA"] }), // cA 发行 sA
    );
    expect(res[0]!.code).toBe("600001");
  });

  it("没人自选时，排序退回原来的「最缺料优先」", async () => {
    const res = await targetsByNeed(makeDb({ flowFor: ["sA", "sB"] }));
    expect(res[0]!.code).toBe("600002");
    expect(res.every((t) => !t.watched)).toBe(true);
  });

  it("报告被跳过的数量，别让降级静默发生", async () => {
    const seen: number[] = [];
    const res = await targetsByNeed(makeDb({ flowFor: ["sA", "sB"] }), {
      onSkip: (n) => seen.push(n),
    });
    expect(res).toHaveLength(3); // sA / sB / sD(NVDA)
    expect(seen).toEqual([1]); // 只剔掉 sC
  });
});

// 热门股定向刷新（QA loop run 7 backlog，run 44 sway 授权执行）：report/media-refresh 原只用 targetsByNeed
// （绑定最少优先=冷尾），热门股永不入选、其每日新研报/媒体被系统性漏采。hotStockTargets 补齐：
// 取近 N 天资讯最多的 top-K 股，与冷尾并行刷新。热度按 STOCK 及其发行 COMPANY 的近期资讯数合计。
describe("hotStockTargets", () => {
  function makeDb() {
    return {
      entity: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sA", name: "甲公司(600001)", ticker: "600001" },
          { id: "sB", name: "乙公司(600002)", ticker: "600002" },
          { id: "sC", name: "丙公司(600003)", ticker: "600003" },
        ]),
      },
      entityRelation: {
        // 公司 cA 发行股票 sA（sA 的热度应含 cA 的资讯）
        findMany: vi.fn().mockResolvedValue([{ fromId: "cA", toId: "sA" }]),
      },
      newsEntity: {
        groupBy: vi.fn().mockResolvedValue([
          { entityId: "sA", _count: { entityId: 3 } },
          { entityId: "cA", _count: { entityId: 2 } }, // sA 合计热度 = 3+2 = 5
          { entityId: "sC", _count: { entityId: 10 } }, // sC 热度 = 10
          // sB 近期无资讯 → 热度 0 → 应被过滤
        ]),
      },
    } as never;
  }

  it("按近期资讯热度降序取 top-K，热度 0 的股被过滤，名字去括号代码", async () => {
    const res = await hotStockTargets(makeDb(), 5);
    expect(res.map((t) => t.code)).toEqual(["600003", "600001"]); // C(10) > A(5)；B(0) 过滤
    expect(res[0]!.name).toBe("丙公司");
    expect(res[1]!.entityIds).toContain("sA");
    expect(res[1]!.entityIds).toContain("cA"); // 含发行公司
  });

  it("尊重 k 上限", async () => {
    const res = await hotStockTargets(makeDb(), 1);
    expect(res.map((t) => t.code)).toEqual(["600003"]);
  });
});
