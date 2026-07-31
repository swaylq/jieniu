import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  isValidPhone,
  maskPhone,
  phoneIdentifier,
} from "./phone";

describe("normalizePhone — 同一个号的各种长相要归成一个", () => {
  it.each([
    "13800138000",
    "138 0013 8000",
    "138-0013-8000",
    "+8613800138000",
    "8613800138000",
    "+86 138 0013 8000",
    "(138)00138000",
  ])("%s → 13800138000", (raw) => {
    expect(normalizePhone(raw)).toBe("13800138000");
  });
});

describe("isValidPhone — 只收中国大陆号", () => {
  it.each(["13800138000", "19912345678", "15012345678", "+86 188 8888 8888"])(
    "合法：%s",
    (p) => expect(isValidPhone(p)).toBe(true),
  );

  it.each([
    "12800138000", // 第二位不能是 1/2
    "1380013800", // 10 位
    "138001380000", // 12 位
    "23800138000", // 不以 1 开头
    "",
    "abcdefghijk",
    "+1 415 555 0100", // 美国号：验证码打过去也发不出，且校验放松等于没校验
  ])("非法：%s", (p) => expect(isValidPhone(p)).toBe(false));
});

describe("maskPhone", () => {
  it("前三后四", () => {
    expect(maskPhone("13800138000")).toBe("138****8000");
    expect(maskPhone("+86 138 0013 8000")).toBe("138****8000");
  });
  it("非法号原样返回，不假装打码", () => {
    expect(maskPhone("123")).toBe("123");
  });
});

describe("phoneIdentifier — 与邮箱共用一列，必须加前缀", () => {
  it("带 phone: 前缀且已归一", () => {
    expect(phoneIdentifier("+86 138-0013-8000")).toBe("phone:13800138000");
  });
  it("和一个长得像手机号的邮箱不会撞", () => {
    expect(phoneIdentifier("13800138000")).not.toBe("13800138000@qq.com");
    expect(phoneIdentifier("13800138000")).not.toBe("13800138000");
  });
});
