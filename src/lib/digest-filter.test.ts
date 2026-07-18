import { describe, it, expect } from "vitest";
import {
  isInauspicious,
  isMacro,
  isMacroItem,
  rankDigest,
  collapseDigestItems,
  type DigestCandidate,
} from "./digest-filter";

const cand = (o: Partial<DigestCandidate> & { id: string; title: string }): DigestCandidate => ({
  importance: 30,
  eventType: null,
  publishedAt: new Date("2026-07-05T08:00:00Z"),
  hasEntity: false,
  entityKeys: [],
  source: { name: "东方财富" },
  ...o,
});

describe("isInauspicious", () => {
  it("flags 退市 / 风险警示 / 破产 / ST 前缀", () => {
    expect(isInauspicious("恒久退:关于公司股票进入退市整理期", "退市")).toBe(true);
    expect(isInauspicious("ST萃华:关于股票交易被实施退市风险警示", "立案")).toBe(true);
    expect(isInauspicious("*ST花王:终止上市", null)).toBe(true);
    expect(isInauspicious("海南发展:子公司破产清算的进展公告", "破产")).toBe(true);
  });
  it("keeps legit major events (控制权/业绩/并购)", () => {
    expect(isInauspicious("好利科技:关于控制权变更暨复牌公告", "控制权")).toBe(false);
    expect(isInauspicious("天山铝业:2026年半年度业绩预告", "业绩预告")).toBe(false);
  });
});

describe("isMacro / isMacroItem", () => {
  it("detects macro/market titles", () => {
    expect(isMacro("环球下周看点：美联储会议纪要来袭")).toBe(true);
    expect(isMacro("经济日报评论：向AI员工征税？")).toBe(true);
    expect(isMacro("兆易创新:2024年股票期权激励计划")).toBe(false);
  });
  it("macro item requires no single-stock entity", () => {
    expect(isMacroItem(cand({ id: "1", title: "央行开展MLF操作", hasEntity: false }))).toBe(true);
    // 个股新闻里带"经济"字样不算宏观
    expect(isMacroItem(cand({ id: "2", title: "招金黄金：受宏观经济影响", hasEntity: true }))).toBe(false);
  });
});

describe("rankDigest", () => {
  it("drops inauspicious items entirely", () => {
    const out = rankDigest(
      [
        cand({ id: "a", title: "恒久退:进入退市整理期", importance: 90, eventType: "退市" }),
        cand({ id: "b", title: "天山铝业:半年度业绩预告", importance: 85, eventType: "业绩预告", hasEntity: true }),
      ],
      6,
    );
    expect(out.map((x) => x.id)).toEqual(["b"]);
  });
  it("lifts macro news above ordinary corporate 公告", () => {
    const out = rankDigest(
      [
        cand({ id: "corp", title: "某公司:回购股份", importance: 45, eventType: "回购", hasEntity: true }),
        cand({ id: "macro", title: "央行宣布降准0.5个百分点", importance: 30, hasEntity: false }),
      ],
      6,
    );
    expect(out[0].id).toBe("macro");
    expect(out[0].macro).toBe(true);
  });
  it("dedupes by id and respects take", () => {
    const out = rankDigest(
      [
        cand({ id: "x", title: "并购重组", importance: 90, hasEntity: true }),
        cand({ id: "x", title: "并购重组", importance: 90, hasEntity: true }),
        cand({ id: "y", title: "重大合同", importance: 80, hasEntity: true }),
      ],
      1,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("x");
  });

  it("同一公司的公告轰炸每家只留 1 条（精测电子重组几十份文档不霸屏）", () => {
    const flood = Array.from({ length: 6 }, (_, i) =>
      cand({
        id: `jc${i}`,
        title: `精测电子:武汉精测电子集团董事会关于本次交易符合《第${i}号规定》`,
        importance: 90,
        hasEntity: true,
        entityKeys: ["jingce"],
      }),
    );
    const other = cand({
      id: "tcl",
      title: "TCL科技:并购重组审核通过",
      importance: 90,
      hasEntity: true,
      entityKeys: ["tcl"],
    });
    const out = rankDigest([...flood, other], 12);
    expect(out.filter((x) => x.id.startsWith("jc"))).toHaveLength(1);
    expect(out.map((x) => x.id)).toContain("tcl");
  });

  it("不同公司不折叠（同板块也各留各的）", () => {
    const out = rankDigest(
      [
        cand({ id: "a", title: "宁德时代:半年度业绩预增", importance: 90, hasEntity: true, entityKeys: ["catl"] }),
        cand({ id: "b", title: "比亚迪:半年度业绩预增", importance: 90, hasEntity: true, entityKeys: ["byd"] }),
      ],
      12,
    );
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });
});

describe("collapseDigestItems", () => {
  const item = (title: string, entityKeys: string[] = []) => ({ title, entityKeys });

  it("近重复快讯碎片折叠：一条标题被另一条包含时只留一条", () => {
    const out = collapseDigestItems(
      [
        item("央行：结合一级交易商需求 研究逐步增加隔夜逆回购的操作频率"),
        item("央行：研究逐步增加隔夜逆回购的操作频率"),
      ],
      12,
    );
    expect(out).toHaveLength(1);
  });

  it("不同政策点（互不包含）全保留", () => {
    const out = collapseDigestItems(
      [
        item("央行：现阶段7天期逆回购利率还是主要政策利率"),
        item("央行：根据流动性需要适当选择存款准备金、逆回购、MLF等工具"),
      ],
      12,
    );
    expect(out).toHaveLength(2);
  });

  it("短标题不做子串折叠（避免误并）", () => {
    const out = collapseDigestItems([item("并购重组"), item("重组")], 12);
    expect(out).toHaveLength(2);
  });

  it("perCompany 上限可调（自选段每股 2 条）", () => {
    const flood = Array.from({ length: 5 }, (_, i) =>
      item(`某股:公告碎片${i}关于本次交易的第${i}份说明文件`, ["s1"]),
    );
    expect(collapseDigestItems(flood, 12, 1)).toHaveLength(1);
    expect(collapseDigestItems(flood, 12, 2)).toHaveLength(2);
  });
});
