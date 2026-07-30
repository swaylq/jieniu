import { describe, it, expect } from "vitest";
import { ecosystemPeers } from "./relation-view";
import type { RelationBucket, RelatedEntity } from "./entity-graph";

const empty = (): Record<RelationBucket, RelatedEntity[]> => ({
  sector: [],
  members: [],
  stocks: [],
  issuer: [],
  worksAt: [],
  people: [],
  related: [],
});
const ent = (id: string, name: string): RelatedEntity => ({
  id,
  name,
  type: "STOCK",
  ticker: null,
});

describe("ecosystemPeers — 关系 tab 不该是空的（sway 反馈）", () => {
  it("公司那份只有一条原始边时，靠 ecosystem 补出行业与竞品", () => {
    // 实测三一重工 COMPANY：出边只有 ISSUES→它发行的股票，别的一条都没有
    const groups = empty();
    groups.stocks = [ent("stk", "三一重工(600031)")];
    const out = ecosystemPeers(groups, {
      sectors: [{ id: "sec", name: "工程机械" }],
      peers: [
        { id: "p1", name: "恒立液压(601100)", ticker: "601100" },
        { id: "p2", name: "徐工机械(000425)", ticker: "000425" },
      ],
    });
    expect(out.sections.map((s) => s.label)).toEqual([
      "所属行业",
      "同行竞品",
      "股票",
    ]);
    expect(out.total).toBe(4); // 工程机械 + 2 竞品 + 1 发行股票
  });

  it("原始边里的板块/成分不再重复展示（ecosystem 那份更全）", () => {
    const groups = empty();
    groups.sector = [ent("sec", "工程机械")];
    groups.members = [ent("m1", "某成分股")];
    groups.issuer = [ent("co", "三一重工")];
    const out = ecosystemPeers(groups, {
      sectors: [{ id: "sec", name: "工程机械" }],
      peers: [],
    });
    expect(out.sections.map((s) => s.key)).toEqual(["sector", "issuer"]);
    expect(out.sections[0]!.items).toEqual([{ id: "sec", name: "工程机械" }]);
  });

  it("计数按对象去重——同一个板块出现在两处只算一次", () => {
    const groups = empty();
    groups.issuer = [ent("co", "三一重工")];
    const out = ecosystemPeers(groups, {
      sectors: [{ id: "sec", name: "工程机械" }],
      peers: [{ id: "co", name: "三一重工", ticker: null }], // 与 issuer 同一个对象
    });
    expect(out.total).toBe(2);
  });

  it("彻底没关系时 total 为 0、分区为空（调用方好据此显空态）", () => {
    const out = ecosystemPeers(empty(), { sectors: [], peers: [] });
    expect(out.total).toBe(0);
    expect(out.sections).toEqual([]);
  });
});
