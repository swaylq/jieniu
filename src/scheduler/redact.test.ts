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

  it("掩码 postgres 连接串密码", () => {
    expect(redact("postgres://postgres:S3cr3t@localhost:5432/jieniu")).toBe(
      "postgres://postgres:***@localhost:5432/jieniu",
    );
  });

  it("掩码 OpenRouter / OpenAI 形态密钥", () => {
    expect(redact("OPENROUTER_API_KEY=sk-or-v1-abcdef1234567890")).toBe(
      "OPENROUTER_API_KEY=sk-or-***",
    );
    expect(redact("sk-abcdefghijklmnopqrstuvwxyz123456")).toBe("sk-***");
  });

  it("掩码 Bearer 令牌", () => {
    expect(
      redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def"),
    ).toBe("Authorization: Bearer ***");
  });

  it("掩码阿里云 AccessKey（LTAI 形状）", () => {
    expect(redact("AccessKeyId=LTAI5t1234567890abcdefgh")).toBe(
      "AccessKeyId=LTAI***",
    );
  });

  it("掩码阿里云 KEY 类环境变量值", () => {
    expect(redact("ALIYUN_ACCESS_KEY_SECRET=abcdef1234567890")).toBe(
      "ALIYUN_ACCESS_KEY_SECRET=***",
    );
  });

  it("Bearer 后接普通短词不误伤", () => {
    expect(redact("the bearer of the bad news")).toBe(
      "the bearer of the bad news",
    );
  });
});
