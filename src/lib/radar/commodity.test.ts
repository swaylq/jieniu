import { describe, it, expect } from "vitest";
import {
  parseSinaFutures,
  commodityEvidence,
  COMMODITY_MAP,
  COMMODITY_SYMS,
  MOVE_HIGH,
  MOVE_MEDIUM,
  asGradedCatalyst,
  isCommodityId,
} from "./commodity";

/** 夹具从真实响应拷贝（2026-07-31 实测 hq.sinajs.cn，GBK 解码后）。 */
const REAL = [
  'var hq_str_nf_LC0="碳酸锂连续,210000,142100.000,142100.000,143500.000,141000.000,142200.000,142100.000,142100.000,144600.000,142200.000,0,0,0,2026-07-31,LC0";',
  'var hq_str_nf_FG0="玻璃连续,210000,890.000,890.000,905.000,881.000,896.000,890.000,890.000,912.000,896.000,0,0,0,2026-07-31,FG0";',
].join("\n");

describe("parseSinaFutures", () => {
  it("解析出品种名、最新价、昨结算，并算出涨跌幅", () => {
    const rows = parseSinaFutures(REAL);
    expect(rows).toHaveLength(2);
    const lc = rows.find((r) => r.sym === "nf_LC0")!;
    expect(lc.name).toBe("碳酸锂连续");
    expect(lc.price).toBeCloseTo(142100, 0);
    // [8]最新价 142100，[10]昨结 142200 → -0.07%
    expect(lc.changePct).toBeCloseTo(((142100 - 142200) / 142200) * 100, 6);
  });

  it("昨结为 0 或缺字段的行直接丢弃，不产生 Infinity", () => {
    expect(parseSinaFutures('var hq_str_nf_XX0="X,0,0,0,0,0,0,0,0,0,0";')).toEqual([]);
    expect(parseSinaFutures("")).toEqual([]);
    expect(parseSinaFutures('var hq_str_nf_YY0="";')).toEqual([]);
  });
});

describe("COMMODITY_MAP", () => {
  it("覆盖 20 个品种", () => {
    expect(COMMODITY_MAP.length).toBeGreaterThanOrEqual(20);
  });

  it("符号列表与映射表一致、无重复", () => {
    expect(new Set(COMMODITY_SYMS).size).toBe(COMMODITY_SYMS.length);
    for (const c of COMMODITY_MAP) expect(COMMODITY_SYMS).toContain(c.sym);
  });

  it("每个品种至少挂一个板块，板块名不带口径歧义（不出现「新能源」「光伏」这类库里没成分股的名字）", () => {
    for (const c of COMMODITY_MAP) {
      expect(c.sectors.length).toBeGreaterThan(0);
      for (const s of c.sectors) {
        expect(s).not.toBe("新能源");
        expect(s).not.toBe("光伏");
      }
    }
  });
});

describe("commodityEvidence（价格变动 → 催化证据）", () => {
  const q = { sym: "nf_LC0", name: "碳酸锂连续", price: 142100, changePct: 0 };
  const day = "2026-07-31";

  it("显著变动（≥3%）算「高」——产品价格是需求 §6 的高档硬数据", () => {
    const e = commodityEvidence({ ...q, changePct: 3.4 }, "碳酸锂", "元/吨", day)!;
    expect(e.grade).toBe("HIGH");
    expect(e.title).toContain("碳酸锂");
    expect(e.title).toContain("3.4");
  });

  it("中等变动（1.5%~3%）算「中」", () => {
    expect(commodityEvidence({ ...q, changePct: 2 }, "碳酸锂", "元/吨", day)!.grade).toBe("MEDIUM");
    expect(commodityEvidence({ ...q, changePct: -2 }, "碳酸锂", "元/吨", day)!.grade).toBe("MEDIUM");
  });

  it("小幅波动不算催化——0.3% 的日内波动是噪音，不是事件", () => {
    expect(commodityEvidence({ ...q, changePct: 0.3 }, "碳酸锂", "元/吨", day)).toBeNull();
    expect(commodityEvidence({ ...q, changePct: -1.4 }, "碳酸锂", "元/吨", day)).toBeNull();
  });

  it("阈值对外可见，测试与文案共用同一份", () => {
    expect(MOVE_HIGH).toBe(3);
    expect(MOVE_MEDIUM).toBe(1.5);
  });

  it("证据自带可点开的原文链接（不是站内新闻 id）", () => {
    const e = commodityEvidence({ ...q, changePct: 5 }, "碳酸锂", "元/吨", day)!;
    expect(e.url).toContain("sina");
    expect(e.url).toContain("LC0");
    expect(e.id).toBe("commodity:nf_LC0:2026-07-31");
    expect(e.sourceName).toContain("期货");
  });

  it("涨跌方向写进标题，用户一眼能看出是涨价还是跌价", () => {
    expect(commodityEvidence({ ...q, changePct: 4 }, "碳酸锂", "元/吨", day)!.title).toContain("上涨");
    expect(commodityEvidence({ ...q, changePct: -4 }, "碳酸锂", "元/吨", day)!.title).toContain("下跌");
  });
});

describe("asGradedCatalyst（商品证据 → 引擎能吃的催化条目）", () => {
  const ev = {
    id: "commodity:nf_LC0:2026-07-31",
    title: "碳酸锂期货上涨 3.4%，报 142100元/吨",
    url: "https://finance.sina.com.cn/futures/quotes/LC0.shtml",
    sourceName: "新浪期货·主力连续",
    publishedAt: "2026-07-31",
    grade: "HIGH" as const,
  };

  it("补齐引擎需要的字段，等级原样带过来", () => {
    const g = asGradedCatalyst(ev);
    expect(g.grade).toBe("HIGH");
    expect(g.title).toBe(ev.title);
    expect(g.id).toBe(ev.id);
    expect(g.publishedAt instanceof Date).toBe(true);
  });

  it("绑定扇出记 1——它讲的就是这一个行业，不是综述稿", () => {
    expect(asGradedCatalyst(ev).boundCount).toBe(1);
  });

  it("合成 id 带 commodity: 前缀，落库时据此与站内资讯 id 分流", () => {
    expect(isCommodityId(asGradedCatalyst(ev).id)).toBe(true);
    expect(isCommodityId("cmg7xk2p90001abcd")).toBe(false);
  });
});
