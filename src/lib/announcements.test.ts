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

  it("定期报告算实质事件，不被程序性文件挤掉代表位", () => {
    const items = [
      it_({ id: "proc1", title: "关于本次交易采取的保密措施及保密制度的说明" }),
      it_({ id: "report", title: "宁德时代:2026年半年度报告" }),
      it_({ id: "proc2", title: "关于本次交易符合《创业板上市公司持续监管办法》的说明" }),
      it_({ id: "proc3", title: "《总经理工作细则》(2026年7月修订)" }),
    ];
    const out = collapseAnnouncementBursts(items, 4);
    expect(out.map((x) => x.id)).toEqual(["report"]);
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

// sway 直报 ④：宁德时代 2026-07-24 11:28 一次甩 12 份一手公告，半年报被折进「另有 11 份」里
// 完全不露面，用户以为「解牛没抓到半年报」。同日撞车两件重磅时，1 条代表不够。
describe("collapseAnnouncementBursts — 同日双重磅（sway 直报 ④）", () => {
  const d = new Date("2026-07-24T11:28:00Z");
  /** 300750 当天那 12 份的真实标题与当时的 importance。 */
  const catl = (): BurstItem[] =>
    [
      { id: "hy", title: "宁德时代:2026年半年度报告", importance: 45 },
      { id: "hy-abs", title: "宁德时代:2026年半年度报告摘要", importance: 45 },
      {
        id: "buyback",
        title: "宁德时代:关于回购公司股份方案的公告暨回购股份报告书",
        importance: 70,
      },
      { id: "div", title: "宁德时代:关于2026年中期分红方案的公告", importance: 65 },
      { id: "p1", title: "宁德时代:第四届董事会第十八次会议决议公告", importance: 45 },
      { id: "p2", title: "宁德时代:关于召开2026年第一次临时股东会通知", importance: 45 },
      { id: "p3", title: "宁德时代:《董事会秘书工作细则》(2026年7月修订)", importance: 45 },
      { id: "p4", title: "宁德时代:《总经理工作细则》(2026年7月修订)", importance: 45 },
      { id: "p5", title: "宁德时代:关于子公司拟注册发行债券的公告", importance: 45 },
      {
        id: "p6",
        title: "宁德时代:关于2026年度第五期绿色科技创新债券发行完成的公告",
        importance: 45,
      },
      {
        id: "p7",
        title:
          "宁德时代:上海市通力律师事务所关于调整股票期权行权价格和限制性股票授予价格的法律意见书",
        importance: 45,
      },
      {
        id: "p8",
        title: "宁德时代:2026年半年度非经营性资金占用及其他关联资金往来情况汇总表",
        importance: 45,
      },
    ].map((o) => it_({ ...o, publishedAt: d }));

  it("半年报与回购同日撞车时，两条都露面", () => {
    const ids = collapseAnnouncementBursts(catl(), 4).map((x) => x.id);
    expect(ids).toContain("hy");
    expect(ids).toContain("buyback");
  });

  it("代表最多 2 条，其余仍折叠", () => {
    const out = collapseAnnouncementBursts(catl(), 4);
    expect(out).toHaveLength(2);
    expect(out.at(-1)!.burstCount).toBe(10);
    expect(out[0]!.burstCount).toBe(0);
  });

  it("摘要不占正文的代表位", () => {
    const ids = collapseAnnouncementBursts(catl(), 4).map((x) => x.id);
    expect(ids).not.toContain("hy-abs");
  });

  it("「半年度非经营性资金占用…汇总表」不是定期报告，不抢代表位", () => {
    const items = [
      it_({ id: "fund", title: "2026年半年度非经营性资金占用及其他关联资金往来情况汇总表" }),
      it_({ id: "stop", title: "关于筹划重大资产重组停牌的公告", importance: 90 }),
      it_({ id: "p1", title: "关于本次交易采取的保密措施的说明" }),
      it_({ id: "p2", title: "关于续聘会计师事务所的公告" }),
    ];
    const ids = collapseAnnouncementBursts(items, 4).map((x) => x.id);
    expect(ids).toEqual(["stop"]);
  });

  it("只有一件实质事件时仍只出 1 条代表（不回退成刷屏）", () => {
    const items = [
      it_({ id: "real", title: "2026年度向特定对象发行A股股票预案" }),
      it_({ id: "p1", title: "关于本次交易采取的保密措施的说明" }),
      it_({ id: "p2", title: "关于本次交易符合《监管办法》的说明" }),
      it_({ id: "p3", title: "《总经理工作细则》(2026年7月修订)" }),
    ];
    const out = collapseAnnouncementBursts(items, 4);
    expect(out.map((x) => x.id)).toEqual(["real"]);
    expect(out[0]!.burstCount).toBe(3);
  });
});
