import { describe, it, expect } from "vitest";

import {
  holderChangeToRawItem,
  shareholderChangeToRawItem,
} from "./eastmoney-holderchange";

// 坏链修复（QA loop run 40 维度 e）：原「查看原文」URL 用了 data.eastmoney.com/executive/gaoguan|gudong/{code}.html
// 这两个子路径在东财已 404（实测同 UA 下其它 data.eastmoney.com 页均 200）。正确的个股高管/股东页是
// data.eastmoney.com/executive/{code}.html（同页含高管+股东增减持），实测 6 个码含北交所 920xxx 全 200。
describe("holderchange 查看原文 URL（不得 404）", () => {
  it("董监高增减持指向 /executive/{code}.html（不含已 404 的 /gaoguan/）", () => {
    const item = holderChangeToRawItem({
      SECURITY_CODE: "000426",
      SECURITY_NAME_ABBR: "兴业矿业",
      PERSON_NAME: "张三",
      POSITION_NAME: "董事",
      CHANGE_SHARES: 12000,
      CHANGE_DATE: "2026-07-28 00:00:00",
    });
    expect(item).not.toBeNull();
    expect(item!.url).toBe("https://data.eastmoney.com/executive/000426.html");
    expect(item!.url).not.toContain("/gaoguan/");
  });

  it("股东增减持指向 /executive/{code}.html（不含已 404 的 /gudong/）", () => {
    const item = shareholderChangeToRawItem({
      SECURITY_CODE: "603231",
      SECURITY_NAME_ABBR: "美畅股份",
      HOLDER_NAME: "某大股东",
      DIRECTION: "增持",
      CHANGE_RATE: 1.5,
      HOLD_RATIO: 10,
      NOTICE_DATE: "2026-07-28 00:00:00",
    });
    expect(item).not.toBeNull();
    expect(item!.url).toBe("https://data.eastmoney.com/executive/603231.html");
    expect(item!.url).not.toContain("/gudong/");
  });
});
