import { describe, it, expect } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("掩码邮箱，只留首字母与域名", () => {
    expect(redact("[alert-mail] → alice@example.com｜投 3 条")).toBe(
      "[alert-mail] → a***@example.com｜投 3 条",
    );
  });

  it("一行里多个邮箱都掩码", () => {
    expect(redact("a@x.com b@y.org")).toBe("a***@x.com b***@y.org");
  });

  it("发件地址同样掩码（宁可多掩，不可漏）", () => {
    expect(redact("MAIL_FROM=noreply@mail.auramate.net")).toBe(
      "MAIL_FROM=n***@mail.auramate.net",
    );
  });

  it("不含邮箱的文本原样返回", () => {
    expect(redact("[signals] 完成：本轮 60 条｜新写信号 25")).toBe(
      "[signals] 完成：本轮 60 条｜新写信号 25",
    );
  });
});
