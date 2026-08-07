import { describe, it, expect } from "vitest";

import type { EntityDictEntry } from "../../../lib/entity-tagging";
import { clsSign, parseClsTelegraph } from "./cls-telegraph";
import { extractNewestArray, parseJin10Flash, mergeByWindow } from "./jin10-flash";

const DICT: EntityDictEntry[] = [
  { id: "e1", type: "STOCK", name: "兆易创新(603986)", shortName: "兆易创新", aliases: [], ticker: "603986" },
  { id: "e2", type: "COMPANY", name: "太平洋", shortName: "太平洋", aliases: [], ticker: null },
  { id: "e3", type: "SECTOR", name: "半导体", shortName: null, aliases: [], ticker: null },
];

// 夹具全部从 2026-08-03 的真实响应里拷（见 evolution/lessons.md「类型声明不是事实」：
// 照类型声明手写夹具会让测试与实现共享同一个错误假设）。
function clsRow(over: Record<string, unknown> = {}) {
  return {
    id: 2444037,
    ctime: 1785739526,
    level: "C",
    title: "长鑫存储增资至约313.9亿 增幅约31%",
    content:
      "【长鑫存储增资至约313.9亿 增幅约31%】财联社8月3日电，天眼查App显示，近日，长鑫存储技术有限公司发生工商变更，注册资本由约238",
    brief:
      "【长鑫存储增资至约313.9亿 增幅约31%】财联社8月3日电，天眼查App显示，近日，长鑫存储技术有限公司发生工商变更，注册资本由约238.9亿人民币增至约313.9亿人民币，增幅约31%。",
    stock_list: [],
    subjects: [],
    ...over,
  };
}

const clsPayload = (rows: unknown[]) => ({ errno: 0, data: { roll_data: rows } });

describe("clsSign", () => {
  it("按 key 字母序拼 query → SHA1 → MD5（实测能换到 errno:0 的那套）", () => {
    // 该值是 2026-08-03 对 www.cls.cn/v1/roll/get_roll_list 实测通过的签名。
    expect(clsSign({ rn: "50", app: "CailianpressWeb", os: "web" })).toBe(
      "e833b86a1feaf6119652b85fd0c52676",
    );
  });

  it("参数顺序不影响结果（内部按 key 排序）", () => {
    const a = clsSign({ app: "X", os: "web", rn: "5" });
    const b = clsSign({ rn: "5", os: "web", app: "X" });
    expect(a).toBe(b);
  });
});

describe("parseClsTelegraph", () => {
  it("把电报映射成 RawNewsItem，正文取 brief（content 是截断版）", () => {
    const res = parseClsTelegraph(clsPayload([clsRow()]));
    expect(res).toHaveLength(1);
    const it0 = res[0]!;
    expect(it0.externalId).toBe("2444037");
    expect(it0.title).toBe("长鑫存储增资至约313.9亿 增幅约31%");
    expect(it0.url).toBe("https://www.cls.cn/detail/2444037");
    // brief 是完整正文，content 字段反而被 API 截断——别取错。
    expect(it0.content).toContain("增幅约31%。");
    expect(it0.content!.length).toBeGreaterThan(clsRow().content.length);
  });

  it("ctime 是秒级 Unix 时间戳，无时区歧义", () => {
    // 真实响应里这条是 CST 2026-08-03 14:45:26 = UTC 06:45:26。
    const res = parseClsTelegraph(clsPayload([clsRow({ ctime: 1785739526 })]));
    expect(res[0]!.publishedAt.toISOString()).toBe("2026-08-03T06:45:26.000Z");
  });

  it("title 为空时从正文的【】里提取（实测 40% 的电报没有 title）", () => {
    const res = parseClsTelegraph(
      clsPayload([
        clsRow({
          title: "",
          content: "【隆基绿能：拟回购】财联社8月3日电，公司公告…",
          brief: "【隆基绿能：拟回购】财联社8月3日电，公司公告…",
        }),
      ]),
    );
    expect(res[0]!.title).toBe("隆基绿能：拟回购");
  });

  it("title 空且正文无【】时用首句兜底", () => {
    const res = parseClsTelegraph(
      clsPayload([
        clsRow({
          title: "",
          content: "财联社8月3日电，红枣期货主力合约大跌5%，报7635元/吨。",
          brief: "财联社8月3日电，红枣期货主力合约大跌5%，报7635元/吨。",
        }),
      ]),
    );
    expect(res[0]!.title).toBe("红枣期货主力合约大跌5%，报7635元/吨");
  });

  it("丢掉【盘中宝】/【电报解读】——财联社 VIP 荐股引流，且刻意不点名公司", () => {
    const res = parseClsTelegraph(
      clsPayload([
        clsRow({
          title:
            "【盘中宝】大模型多模态能力不断成熟，该行业或从概念验证走向规模放量，这家企业拥有在手订单",
        }),
        clsRow({
          id: 2,
          title: "",
          content: "【电报解读】MLCC龙头上调业绩预期，这家公司已构建全产业链",
          brief: "【电报解读】MLCC龙头上调业绩预期，这家公司已构建全产业链",
        }),
        clsRow({ id: 3 }),
      ]),
    );
    expect(res.map((r) => r.externalId)).toEqual(["3"]);
  });

  // 防御性的门：实测 50 条的扇出分布是 {0:45, 6:1, 7:1, 8:3}，1~2 只这档**从不出现**
  // （stock_list 的真实语义是「本条提到的股票」而非「本条的主体」）。留着是为了万一
  // 财联社哪天给单股快讯挂上主体时能接住。
  it("stock_list 只挂 1~2 只 → 当权威主体给 entityHints（简称 + 纯代码）", () => {
    const res = parseClsTelegraph(
      clsPayload([
        clsRow({
          stock_list: [{ name: "兆易创新", StockID: "sh603986" }],
        }),
      ]),
    );
    expect(res[0]!.entityHints).toEqual(["兆易创新", "603986"]);
  });

  it("stock_list 挂 3 只以上 → 不给 entityHints（是涨跌停盘点这类综述）", () => {
    // 实测样例：一条挂了 8 只股（华电辽能/中国巨石/兆易创新…），正是「绑定扇出 ≥3 = 综述」
    // 那个判据要挡的形状；给了 hints 会让它绑到 8 家公司头上，污染自选早报。
    const res = parseClsTelegraph(
      clsPayload([
        clsRow({
          stock_list: [
            { name: "华电辽能", StockID: "sh600396" },
            { name: "中国巨石", StockID: "sh600176" },
            { name: "德明利", StockID: "sz001309" },
          ],
        }),
      ]),
    );
    expect(res[0]!.entityHints).toBeUndefined();
  });

  it("扛得住缺字段 / 空响应，不抛", () => {
    expect(parseClsTelegraph({ errno: 0, data: { roll_data: [] } })).toEqual([]);
    expect(parseClsTelegraph({})).toEqual([]);
    expect(parseClsTelegraph(null)).toEqual([]);
    // 正文与标题都空 → 丢，别插一条空标题
    expect(
      parseClsTelegraph(
        clsPayload([clsRow({ title: "", content: "", brief: "" })]),
      ),
    ).toEqual([]);
  });
});

describe("parseClsTelegraph — level 加红分级接进 importance", () => {
  // 实测 50 条分布 {C:45, B:5}：B 级是 TrendForce DRAM 涨价 15~20%、涨停分析、收评这类，
  // 确实是重磅；C 级是水库泄洪、现代汽车销量这类基线内容。不接的话两者同为 30 分。
  it("level=B → importanceFloor 60（越过重磅线 55）", () => {
    const res = parseClsTelegraph(
      clsPayload([clsRow({ level: "B", title: "TrendForce：预计三季度PC DRAM价格环比涨15%至20%" })]),
    );
    expect(res[0]!.importanceFloor).toBe(60);
  });

  it("level=A → importanceFloor 70", () => {
    const res = parseClsTelegraph(clsPayload([clsRow({ level: "A" })]));
    expect(res[0]!.importanceFloor).toBe(70);
  });

  it("level=C（九成的量）不设底分，走原有打分", () => {
    const res = parseClsTelegraph(clsPayload([clsRow({ level: "C" })]));
    expect(res[0]!.importanceFloor).toBeUndefined();
  });
});

describe("parseClsTelegraph — 噪音过滤", () => {
  const drop = (title: string, over: Record<string, unknown> = {}) =>
    parseClsTelegraph(clsPayload([clsRow({ title, ...over })]), DICT);

  it("挡掉海外指数 / 国债行情", () => {
    expect(drop("英国10年期国债收益率下跌7个基点至4.98%")).toEqual([]);
    expect(drop("澳大利亚标普澳股200指数收涨0.5%，报9019.30点")).toEqual([]);
    expect(drop("台交所加权股价指数收高0.6%报43,386.41点")).toEqual([]);
    expect(drop("菲律宾股指收盘上涨1.6%，至6,334.72点")).toEqual([]);
  });

  // 行情类判据必须先命中海外市场标识才生效。第一版漏了这个前提，逐条复核时抓到
  // 它把 A 股收评和国内航运指数一起误杀了——正则单测当时是全绿的。
  it("不误杀 A 股 / 国内的指数行情", () => {
    expect(drop("收评：科创50指数低开低走跌超5% 核电板块逆势走强")).toHaveLength(1);
    expect(
      drop("据上海航运交易所数据，上海出口集装箱结算运价指数（欧洲航线）报3519.81点"),
    ).toHaveLength(1);
    expect(drop("恒生科技指数跌超2%")).toHaveLength(1);
  });

  it("挡掉海外个股报价与汇率报价", () => {
    expect(drop("阿斯利康股价在Tradegate交易所下跌2.75%")).toEqual([]);
    expect(drop("台币兑美元下跌0.5%至32.454")).toEqual([]);
    // 这两条是真实数据冒烟里漏网的措辞变体：涨跌词后面跟的是逗号/「升至」而不是数字%
    expect(drop("英国上市能源公司股价下跌，伊萨卡能源下跌4.1%，壳牌下跌2.1%")).toEqual([]);
    expect(drop("菲律宾比索兑美元升至60.948，为6月24日以来最高水平")).toEqual([]);
    // 标题里没有任何国名/市场名，光靠措辞判——「XX股价下跌N%」是外媒行情体裁
    expect(drop("阿斯利康股价下跌7.8%，至2025年10月以来最低水平")).toEqual([]);
  });

  it("挡掉海外公司财报数字", () => {
    expect(drop("三菱日联第一季度净利润8,094.3亿日元，预估6,334.1亿日元")).toEqual([]);
  });

  it("挡掉民生 / 灾害 / 社会新闻", () => {
    expect(drop("局地将超50℃ 新疆发布高温红色预警")).toEqual([]);
    expect(drop("四川宜宾市高县发生4.2级地震 震源深度5千米")).toEqual([]);
    expect(drop("汕头市澄海区市监局通报2家经营主体涉及牛蛙产品抗生素超标")).toEqual([]);
    expect(drop("马杜罗狱中发声：欢迎任何途径对话")).toEqual([]);
  });

  it("挡掉零 A 股关联的海外并购（「交易完成后将退市」会被 detectEventType 误判成 75 分重磅）", () => {
    expect(
      drop("普睿司曼与安科签署收购协议，收购报价95美元/股，交易完成后Atkore将退市"),
    ).toEqual([]);
  });

  it("护栏：标题里出现 A 股公司 / 股票 → 无条件保留", () => {
    // 「港股存储概念跌幅扩大…兆易创新」命中「海外个股报价」判据，但它绑着 A 股标的，必须留。
    const res = drop("港股存储概念跌幅扩大，南方两倍做多海力士跌超16%，兆易创新股价下跌3.2%");
    expect(res).toHaveLength(1);
  });

  // 这一对必须成对看：单独一条证明不了护栏在工作——标题若压根不命中噪音判据，
  // 护栏看不看正文结果都一样（第一版测试就栽在这，断言了结果没确保前提）。
  it("护栏只看标题：正文里的「太平洋板块」是地质术语，护不住这条灾害新闻", () => {
    const res = drop(
      "最新研究称超大地震未来或重创美国西海岸 给加州造成高达1万亿美元损失",
      { brief: "…圣安德烈亚斯断层位于太平洋板块与北美板块交界处…" },
    );
    expect(res).toEqual([]);
  });

  it("同一条噪音判据，公司名出现在标题里就护得住（证明护栏真的在工作）", () => {
    const res = drop("太平洋：关于超大地震险种赔付影响的说明");
    expect(res).toHaveLength(1);
  });

  it("不传 dict 时不做噪音过滤（保持纯解析语义，单测夹具无需喂词典）", () => {
    const res = parseClsTelegraph(
      clsPayload([clsRow({ title: "四川宜宾市高县发生4.2级地震 震源深度5千米" })]),
    );
    expect(res).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

function jinRow(over: Record<string, unknown> = {}) {
  return {
    id: "20260803144617188800",
    time: "2026-08-03 14:46:17",
    type: 0,
    important: 1,
    data: {
      title: "",
      content:
        "【杠杆ETF引发市场波动争议，韩国总统府高官面临刑事指控】金十数据8月3日讯，据韩国《中央日报》…",
      link: "",
      tag: "",
    },
    ...over,
  };
}

const jinPayload = (rows: unknown[]) => ({ status: 200, data: rows });

describe("parseJin10Flash", () => {
  it("映射成 RawNewsItem，标题从【】提取", () => {
    const res = parseJin10Flash(jinPayload([jinRow()]));
    expect(res).toHaveLength(1);
    expect(res[0]!.title).toBe(
      "杠杆ETF引发市场波动争议，韩国总统府高官面临刑事指控",
    );
    expect(res[0]!.externalId).toBe("20260803144617188800");
    expect(res[0]!.url).toBe("https://www.jin10.com/detail/20260803144617188800");
  });

  it("time 按东八区解析", () => {
    const res = parseJin10Flash(jinPayload([jinRow()]));
    expect(res[0]!.publishedAt.toISOString()).toBe("2026-08-03T06:46:17.000Z");
  });

  it("只留 important=1——金十日产约 1000 条，全量入库会淹掉首页时间线", () => {
    const res = parseJin10Flash(
      jinPayload([jinRow({ important: 0 }), jinRow({ id: "keep" })]),
    );
    expect(res.map((r) => r.externalId)).toEqual(["keep"]);
  });

  it("丢掉 type=2 / tag=VIP / xnews 链接——金十自家付费内容引流", () => {
    const res = parseJin10Flash(
      jinPayload([
        jinRow({ id: "ad1", type: 2 }),
        jinRow({ id: "ad2", data: { ...jinRow().data, tag: "VIP" } }),
        jinRow({
          id: "ad3",
          data: { ...jinRow().data, link: "https://xnews.jin10.com/details/226438" },
        }),
        jinRow({ id: "keep" }),
      ]),
    );
    expect(res.map((r) => r.externalId)).toEqual(["keep"]);
  });

  it("丢掉 type=1 经济数据日历——没有可读标题，只有 actual/consensus 数字", () => {
    const res = parseJin10Flash(
      jinPayload([
        { id: "cal", time: "2026-08-03 14:00:00", type: 1, important: 1, data: { country: "瑞士", actual: -0.1, consensus: "-0.10" } },
      ]),
    );
    expect(res).toEqual([]);
  });

  it("丢掉英文版——金十同一条快讯中英双推，实测 9 条里 4 条是重复的英文版", () => {
    const res = parseJin10Flash(
      jinPayload([
        jinRow({
          id: "en",
          data: {
            ...jinRow().data,
            content:
              "Japan stocks close down 0.94%; South Korea's two major indices mixed",
          },
        }),
        jinRow({
          id: "zh",
          data: { ...jinRow().data, content: "日股收跌0.94% 韩国两大股指涨跌不一" },
        }),
      ]),
    );
    expect(res.map((r) => r.externalId)).toEqual(["zh"]);
  });

  it("剥掉正文里的 HTML 标签（实测 50 条里有 1 条带 <b>）", () => {
    const res = parseJin10Flash(
      jinPayload([
        jinRow({
          data: {
            ...jinRow().data,
            content: "<b>瑞士7月CPI月率 -0.1%</b>，预期-0.10%",
          },
        }),
      ]),
    );
    expect(res[0]!.title).toBe("瑞士7月CPI月率 -0.1%，预期-0.10%");
    expect(res[0]!.content).not.toContain("<b>");
  });

  it("同时吃裸数组和 {data:[]} 两种形态（两个端点各返一种）", () => {
    const bare = parseJin10Flash([jinRow()]);
    const wrapped = parseJin10Flash(jinPayload([jinRow()]));
    expect(bare).toHaveLength(1);
    expect(wrapped).toHaveLength(1);
  });

  it("扛得住缺字段 / 空响应，不抛", () => {
    expect(parseJin10Flash(jinPayload([]))).toEqual([]);
    expect(parseJin10Flash({})).toEqual([]);
    expect(parseJin10Flash(null)).toEqual([]);
    expect(
      parseJin10Flash(jinPayload([jinRow({ data: { title: "", content: "" } })])),
    ).toEqual([]);
  });
});

describe("mergeByWindow", () => {
  const row = (id: string, time: string) => ({ id, time });

  it("窗口够长就不翻页（第二页压根不该被请求）", () => {
    const first = [row("a", "2026-08-03 15:00:00"), row("b", "2026-08-03 14:00:00")];
    expect(mergeByWindow(first, [])).toHaveLength(2);
  });

  it("按 id 去重合并两页", () => {
    const first = [row("a", "2026-08-03 15:00:00"), row("b", "2026-08-03 14:50:00")];
    const second = [row("b", "2026-08-03 14:50:00"), row("c", "2026-08-03 14:20:00")];
    const merged = mergeByWindow(first, second);
    expect(merged.map((r) => (r as { id: string }).id)).toEqual(["a", "b", "c"]);
  });

  it("合并结果按时间倒序，缺 time 的条目不参与也不丢", () => {
    const merged = mergeByWindow(
      [row("old", "2026-08-03 14:00:00"), { id: "noTime" }],
      [row("new", "2026-08-03 15:00:00")],
    );
    expect(merged).toHaveLength(3);
    expect((merged[0] as { id: string }).id).toBe("new");
  });
});

describe("extractNewestArray", () => {
  it("从 `var newest = [...];` 的 JS 壳里剥出数组", () => {
    const js = 'var newest = [{"id":"1","time":"2026-08-03 15:00:18"}];';
    expect(extractNewestArray(js)).toEqual([
      { id: "1", time: "2026-08-03 15:00:18" },
    ]);
  });

  it("剥不出来时返回空数组，不抛（端点改版是静默的）", () => {
    expect(extractNewestArray("window.foo = 1;")).toEqual([]);
    expect(extractNewestArray("var newest = [坏JSON;")).toEqual([]);
    expect(extractNewestArray("")).toEqual([]);
  });
});
