import { describe, it, expect } from "vitest";
import {
  exchangeFromCode,
  isSeedableStock,
  isDelistingNoise,
  hasTempPrefix,
} from "./universe";

describe("exchangeFromCode", () => {
  it("maps code prefixes to exchanges", () => {
    expect(exchangeFromCode("600519")).toBe("SH");
    expect(exchangeFromCode("000001")).toBe("SZ");
    expect(exchangeFromCode("300750")).toBe("SZ");
    expect(exchangeFromCode("830799")).toBe("BJ");
    expect(exchangeFromCode("430047")).toBe("BJ");
  });
});

describe("isSeedableStock", () => {
  it("keeps ordinary companies", () => {
    expect(isSeedableStock("贵州茅台")).toBe(true);
    expect(isSeedableStock("宁德时代")).toBe(true);
    expect(isSeedableStock("兆易创新")).toBe(true);
  });
  it("drops ETF / 指数 / 基金 / REIT", () => {
    expect(isSeedableStock("沪深300ETF")).toBe(false);
    expect(isSeedableStock("中证500指数")).toBe(false);
    expect(isSeedableStock("华夏基金")).toBe(false);
  });
  it("drops ST / *ST / 退市 股（晦气、没人关注）", () => {
    expect(isSeedableStock("ST萃华")).toBe(false);
    expect(isSeedableStock("*ST花王")).toBe(false);
    expect(isSeedableStock("恒久退")).toBe(false);
    expect(isSeedableStock("国华退")).toBe(false);
  });
});

describe("isDelistingNoise", () => {
  it("ST/退 个股的公告一律算噪声（张楚寒：这种股票关注的人根本没有）", () => {
    expect(
      isDelistingNoise("赛隆退", "关于公司股票进入退市整理交易的第五次风险提示公告"),
    ).toBe(true);
    expect(isDelistingNoise("国华退", "关于公司股票进入退市整理交易的第八次风险提示公告")).toBe(
      true,
    );
    expect(isDelistingNoise("*ST泛海", "关于召开股东大会的通知")).toBe(true);
    expect(isDelistingNoise("华夏科创50ETF", "份额变动公告")).toBe(true);
  });

  it("正常个股的退市流程类标题也算噪声", () => {
    expect(isDelistingNoise("某某股份", "关于进入退市整理期的公告")).toBe(true);
    expect(isDelistingNoise("某某科技", "关于公司股票退市风险提示的公告")).toBe(true);
  });

  it("可转债到期兑付/摘牌不误杀（正常公司的正常公司行为）", () => {
    expect(isDelistingNoise("弘亚数控", "关于“弘亚转债”到期兑付及摘牌的公告")).toBe(false);
    expect(
      isDelistingNoise("艾迪精密", "关于实施“艾迪转债”赎回暨摘牌的第十次提示性公告"),
    ).toBe(false);
  });

  it("正常个股的正常公告不算噪声", () => {
    expect(isDelistingNoise("贵州茅台", "2026年半年度业绩预告")).toBe(false);
    expect(isDelistingNoise("宁德时代", "关于对外投资建设电池工厂的公告")).toBe(false);
    expect(isDelistingNoise("兆易创新", "关于回购公司股份的进展公告")).toBe(false);
  });
});

describe("hasTempPrefix（交易所临时简称前缀 / 回归测试）", () => {
  it("认出除权除息日的 XD / XR / DR 前缀", () => {
    // 真实踩过的坑：seed 撞上除息日，抓到「XD华电新」(真名 华电新能，还被截断一个字)
    expect(hasTempPrefix("XD华电新")).toBe(true);
    expect(hasTempPrefix("XD金山办")).toBe(true);
    expect(hasTempPrefix("XR宁德时")).toBe(true);
    expect(hasTempPrefix("DR贵州茅")).toBe(true);
  });

  it("不误伤正常公司名", () => {
    expect(hasTempPrefix("华电新能")).toBe(false);
    expect(hasTempPrefix("中芯国际")).toBe(false);
    expect(hasTempPrefix("金山办公")).toBe(false);
  });

  it("不误伤以英文起头的正常名与 ST 系列", () => {
    // TCL/N 等不是除权除息标记：TCL 是名字本身，N 是新股首日标记（另有 isSeedableStock 管 ST）
    expect(hasTempPrefix("TCL科技")).toBe(false);
    expect(hasTempPrefix("ST生物")).toBe(false);
    expect(hasTempPrefix("*ST海核")).toBe(false);
    expect(hasTempPrefix("N英搏")).toBe(false);
  });

  it("前缀后必须紧跟中文才算（避免 XDA 之类英文名误判）", () => {
    expect(hasTempPrefix("XDATA")).toBe(false);
    expect(hasTempPrefix("DRAM存储")).toBe(false); // DRAM 是词、不是 DR+中文
  });

  it("容忍首尾空白", () => {
    expect(hasTempPrefix("  XD华电新 ")).toBe(true);
  });
});
