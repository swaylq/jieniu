import { describe, it, expect } from "vitest";
import {
  isRoundupNews,
  isEtfMarketing,
  isIntermediaryRole,
  isIntermediaryName,
  isInstitutionOpinionAboutOthers,
  isBoilerplateFiling,
  isForeignMarketNoise,
  isForeignFinancialNoise,
} from "./relevance";

describe("isRoundupNews", () => {
  it("flags market recaps / index roundups by title", () => {
    for (const t of [
      "港股开盘：恒生指数高开0.87% 恒生科技指数高开0.78%",
      "7月10日午间收评：沪指低开高走涨0.76%，全市场上涨个股近4500只",
      "7月10日收评：科创50冲高回落跌5.53%，半导体芯片股集体调整",
      "中概股奇富科技收跌超11%，网易跌超4%，阿里涨1%",
    ]) {
      expect(isRoundupNews(t, 2)).toBe(true);
    }
  });

  it("flags multi-stock lists / fund roundups by title", () => {
    for (const t of [
      "最高预增超10倍！港股上市公司密集发布业绩预告",
      "多只“翻倍基”二季报出炉！科技赛道调仓分化",
      "8只个股大宗交易超5000万元",
      "中欧价值派基金经理公布二季报：蓝小康降仓防守，柳世庆重仓押注地产",
      "公募基金二季报陆续亮相 十年业绩首次展示",
    ]) {
      expect(isRoundupNews(t, 2)).toBe(true);
    }
  });

  it("flags anything binding to >=8 entities regardless of title", () => {
    expect(isRoundupNews("某个看似普通的标题", 8)).toBe(true);
    expect(isRoundupNews("某个看似普通的标题", 7)).toBe(false);
  });

  it("flags 盘前情报 / 十大券商策略 briefs (tail tightening)", () => {
    expect(isRoundupNews("美军称对伊朗发起新一轮打击；国常会部署丨盘前情报", 2)).toBe(true);
    expect(isRoundupNews("十大券商策略：A股或将震荡整固 在波动中把握结构性机会", 2)).toBe(true);
  });

  it("flags 涨停榜 / N只股 / 研报一览 roundups (run5 tail)", () => {
    expect(isRoundupNews("203只股上午收盘涨停(附股)", 2)).toBe(true);
    expect(isRoundupNews("6月23日券商研报对A股公司盈利预测一览：下调35家，上调34家", 2)).toBe(true);
    // 真·个股新闻不误伤
    expect(isRoundupNews("新化股份2025年年度权益分派实施公告", 2)).toBe(false);
    expect(isRoundupNews("新化股份关于开展外汇衍生品交易公告", 2)).toBe(false);
  });

  it("does NOT flag genuine single/dual-stock news", () => {
    for (const t of [
      "铜冠矿建公司中标宁德时代旗下大坪磷矿超深竖井工程",
      "澜起科技关于2025年第二次回购A股股份方案回购股份进展的公告",
      "领益智造开盘涨停", // 裸「开盘」不应误伤个股新闻
      "兆易创新发布2025年半年度业绩预告",
      "宁德时代与特斯拉签署长期供货协议",
    ]) {
      expect(isRoundupNews(t, 2)).toBe(false);
    }
  });
});

describe("isEtfMarketing", () => {
  it("flags ETF marketing blurbs (ETF + bracketed fund code)", () => {
    for (const t of [
      "机床ETF华夏(159663)日均成交1.25亿，AI浪潮持续推升高端设备制造需求",
      "自由现金流ETF华夏(159201)涨超2.3%",
      "科创医药ETF华夏(588130)连续11天获资金净流入",
      "公用事业ETF鹏华（560190）涨近1%",
    ]) {
      expect(isEtfMarketing(t)).toBe(true);
    }
  });

  it("does NOT flag non-ETF company news", () => {
    expect(isEtfMarketing("宁德时代发布2025年半年报")).toBe(false);
    expect(isEtfMarketing("华夏银行(600015)披露分红方案")).toBe(false); // 无 ETF 字样
  });
});

describe("isIntermediaryRole", () => {
  it("flags 券商作保荐/核查中介 的公告（主体是被保荐公司）", () => {
    for (const t of [
      "航材股份:中信证券股份有限公司关于北京航空材料研究院股份有限公司首次公开发行部分限售股上市流通的核查意见",
      "三安光电:中信证券股份有限公司关于三安光电股份有限公司使用部分暂时闲置募集资金临时补充流动资金的核查意见",
      "大族数控:中信证券股份有限公司关于深圳市大族数控科技股份有限公司A股募投项目结项并将节余募集资金永久补充流动资金的核查意见",
      "长江存储IPO辅导首期完成 券商31人“辅导天团”引关注",
      "长江存储公布IPO辅导团队 中信与中信建投合计31人组成",
      "五矿发展:中信证券股份有限公司关于本次重组信息公布前公司股票价格波动情况的核查意见",
    ]) {
      expect(isIntermediaryRole(t)).toBe(true);
    }
  });

  it("does NOT flag 券商自身 的真新闻（研报观点 / 自身业务）", () => {
    for (const t of [
      "中信证券：继续全面看好国产算力产业链",
      "中信证券：美国6月CPI全面低于预期",
      "中信证券保荐业务收入同比增长", // 裸「保荐」不误伤自身业务新闻
      "华泰证券2025年半年度业绩预告",
      "今年以来券商境内发债规模同比增长近一倍",
    ]) {
      expect(isIntermediaryRole(t)).toBe(false);
    }
  });
});

describe("isIntermediaryName", () => {
  it("flags 券商 / 事务所 / 评估 by name", () => {
    for (const n of ["中信证券", "华泰证券", "招商证券", "天健会计师事务所", "国浩律师事务所"]) {
      expect(isIntermediaryName(n)).toBe(true);
    }
  });
  it("does NOT flag operating companies", () => {
    for (const n of ["宁德时代", "三安光电", "大族数控", "航材股份", "中金公司"]) {
      // 中金公司无「证券」字样——靠券商板块 BELONGS_TO 补齐，名字判定这里为 false 属预期
      expect(isIntermediaryName(n)).toBe(false);
    }
  });
});

describe("isInstitutionOpinionAboutOthers", () => {
  it("flags 机构对外研报观点（应从机构自身剪掉绑定）", () => {
    for (const t of [
      "中信证券：继续全面看好国产算力产业链",
      "中信证券：美国6月CPI全面低于预期 仍预计美联储今年全年按兵不动",
      "中信证券：汽车行业主线将转向出口兑现与盈利修复",
      "中信证券：关注2026-2027年民营商业航天企业的IPO进程",
      "华泰证券：给予宁德时代买入评级",
    ]) {
      expect(isInstitutionOpinionAboutOthers(t, "中信证券") || isInstitutionOpinionAboutOthers(t, "华泰证券")).toBe(true);
    }
  });

  it("does NOT flag 机构自身业绩/公司事件（必须保留绑定）", () => {
    expect(isInstitutionOpinionAboutOthers("中信证券：预计上半年净利润同比增长69.59%", "中信证券")).toBe(false);
    expect(isInstitutionOpinionAboutOthers("中信证券：预计上半年净利润人民币233.43亿元", "中信证券")).toBe(false);
    expect(isInstitutionOpinionAboutOthers("中信证券：董事会通过回购股份方案", "中信证券")).toBe(false);
  });

  it("does NOT flag titles not prefixed by the institution name", () => {
    // 「机构：」前缀不匹配则不处理（正文提到不算观点体裁）
    expect(isInstitutionOpinionAboutOthers("铜冠矿建中标宁德时代旗下大坪磷矿", "中信证券")).toBe(false);
    expect(isInstitutionOpinionAboutOthers("宁德时代：拟投建新基地", "宁德时代")).toBe(true); // 前缀匹配、无自身事件词→按观点，但 runner 只对券商生效
  });
});

describe("isBoilerplateFiling", () => {
  it("flags 纯治理/文件类模板公告", () => {
    for (const t of [
      "泛微网络:泛微网络公司章程(2026年5月21日修订)",
      "新凤鸣:公司章程修正案",
      "新天绿能:新天绿能H股公告",
      "龙旗科技:H股公告-截至2026年6月30日止之股份发行人的证券变动月报表",
      "浙江新化化工股份有限公司证券投资、期货与衍生品交易管理制度",
      "董事履职评价及薪酬管理办法",
      "翌日披露報表",
    ]) {
      expect(isBoilerplateFiling(t)).toBe(true);
    }
  });

  it("does NOT flag 有实质信息的公告（含法律意见书类分红/激励/回购）", () => {
    for (const t of [
      "华熙生物:北京市通商律师事务所关于华熙生物科技股份有限公司差异化分红事项之专项法律意见书",
      "中科三环:关于2026年股权激励计划(草案)的法律意见书",
      "兆易创新:2025年半年度业绩预告",
      "宁德时代关于回购股份进展的公告",
      "东山精密中标5亿元项目",
    ]) {
      expect(isBoilerplateFiling(t)).toBe(false);
    }
  });
});

describe("isForeignMarketNoise", () => {
  it("flags 海外市场盘面碎讯", () => {
    for (const t of [
      "美股跌幅扩大",
      "纳指期货转涨",
      "日韩股市集体低开",
      "中概股普跌",
      "标普500指数期货转涨",
      "日经225指数转涨",
    ]) {
      expect(isForeignMarketNoise(t)).toBe(true);
    }
  });

  it("does NOT flag A股/实质性海外资讯", () => {
    for (const t of [
      "英伟达Q2营收超预期 数据中心业务翻倍", // 非「海外市场词开头+涨跌结尾」
      "宁德时代与特斯拉签署长期供货协议",
      "央行：研究逐步增加隔夜逆回购操作频率",
    ]) {
      expect(isForeignMarketNoise(t)).toBe(false);
    }
  });
});

describe("isForeignFinancialNoise", () => {
  it("flags 海外投行/银行自家事务碎讯（runner 再按 0 绑定门槛丢弃）", () => {
    for (const t of [
      "摩根士丹利第二季度净营收213.5亿美元，预估195.8亿美元",
      "花旗预计第四季度平均铜价将达到每吨14,500美元",
      "美国银行向OpenAI提供5.2亿美元信贷额度",
      "高盛预计波斯湾石油流量将在7月底恢复",
    ]) {
      expect(isForeignFinancialNoise(t)).toBe(true);
    }
  });

  it("does NOT flag 无海外投行名 / A股 / 供应链科技名", () => {
    for (const t of [
      "宁德时代与特斯拉签署长期供货协议",
      "央行：研究逐步增加隔夜逆回购操作频率",
      "Meta拟在加拿大建海外最大数据中心", // Meta 不在列（供应链相关，交给 0 绑定自然处理）
      "中国银行发布2025年半年报", // 「中国银行」≠「美国银行」，不误伤
    ]) {
      expect(isForeignFinancialNoise(t)).toBe(false);
    }
  });
});
