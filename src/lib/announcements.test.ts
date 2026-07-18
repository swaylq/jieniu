import { describe, it, expect } from "vitest";
import { collapseAnnouncementBursts, type BurstItem } from "./announcements";

const it_ = (
  o: Partial<BurstItem> & { id: string; title: string },
): BurstItem => ({
  tier: "PRIMARY",
  importance: 45,
  publishedAt: new Date("2026-07-15T16:00:00Z"),
  ...o,
});

describe("collapseAnnouncementBursts", () => {
  it("同日 ≥ 阈值的一手公告折成 1 条代表 + burstCount", () => {
    const day = new Date("2026-07-15T16:00:00Z");
    const flood = Array.from({ length: 19 }, (_, i) =>
      it_({ id: `f${i}`, title: `关于本次交易符合《规定${i}》的说明`, publishedAt: day }),
    );
    const out = collapseAnnouncementBursts(flood, 4);
    expect(out).toHaveLength(1);
    expect(out[0]!.burstCount).toBe(18);
  });

  it("代表优先选实质公告（非程序性样板）", () => {
    const day = new Date("2026-07-15T16:00:00Z");
    const items = [
      it_({ id: "proc1", title: "关于本次交易符合《创业板上市公司持续监管办法》的说明" }),
      it_({ id: "real", title: "2026年度向特定对象发行A股股票预案", importance: 45 }),
      it_({ id: "proc2", title: "关于本次交易采取的保密措施及保密制度的说明" }),
      it_({ id: "proc3", title: "关于本次交易相关主体不存在《监管指引第X号》所规定情形" }),
    ];
    const out = collapseAnnouncementBursts(items, 4);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("real");
    expect(out[0]!.burstCount).toBe(3);
  });

  it("高重要性优先当代表（同为非程序性时）", () => {
    const day = new Date("2026-07-15T16:00:00Z");
    const items = [
      it_({ id: "a", title: "关于召开临时股东会的通知", importance: 45 }),
      it_({ id: "b", title: "关于筹划重大资产重组停牌", importance: 90 }),
      it_({ id: "c", title: "关于续聘会计师事务所", importance: 45 }),
      it_({ id: "d", title: "关于未来三年分红规划", importance: 45 }),
    ];
    const out = collapseAnnouncementBursts(items, 4);
    expect(out[0]!.id).toBe("b");
  });

  it("不足阈值的小簇全部保留、不折叠", () => {
    const items = [
      it_({ id: "a", title: "关于回购股份的公告" }),
      it_({ id: "b", title: "关于股东减持的公告" }),
      it_({ id: "c", title: "关于对外担保的公告" }),
    ];
    const out = collapseAnnouncementBursts(items, 4);
    expect(out).toHaveLength(3);
    expect(out.every((x) => x.burstCount === 0)).toBe(true);
  });

  it("不同日各自折叠、媒体资讯原样穿过", () => {
    const d15 = new Date("2026-07-15T16:00:00Z");
    const d07 = new Date("2026-07-07T16:00:00Z");
    const items = [
      ...Array.from({ length: 5 }, (_, i) =>
        it_({ id: `x${i}`, title: `15日文档${i}关于本次交易的说明`, publishedAt: d15 }),
      ),
      it_({ id: "m", title: "某券商研报看好该公司", tier: "MEDIA", publishedAt: d15 }),
      ...Array.from({ length: 6 }, (_, i) =>
        it_({ id: `y${i}`, title: `7日文档${i}关于定增的说明`, publishedAt: d07 }),
      ),
    ];
    const out = collapseAnnouncementBursts(items, 4);
    // 15 日簇折 1 + 媒体 1 穿过 + 7 日簇折 1 = 3
    expect(out).toHaveLength(3);
    const media = out.find((x) => x.tier === "MEDIA");
    expect(media?.burstCount).toBe(0);
    expect(out.filter((x) => x.tier === "PRIMARY").map((x) => x.burstCount).sort()).toEqual([4, 5]);
  });
});
