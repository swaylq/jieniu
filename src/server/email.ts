import Core from "@alicloud/pop-core";
import { env } from "~/env";

let client: Core | null = null;

function getClient(): Core | null {
  if (!env.ALI_KEY || !env.ALI_SECRET) return null;
  client ??= new Core({
    accessKeyId: env.ALI_KEY,
    accessKeySecret: env.ALI_SECRET,
    endpoint:
      env.ALI_REGION === "ap-southeast-1"
        ? "https://dm.ap-southeast-1.aliyuncs.com"
        : "https://dm.aliyuncs.com",
    apiVersion: "2015-11-23",
  });
  return client;
}

/** 从 MAIL_FROM 取纯地址部分（阿里云校验的是地址，不含显示名）。 */
function senderAddress(): string {
  return (/<([^>]+)>/.exec(env.MAIL_FROM)?.[1] ?? env.MAIL_FROM).trim();
}

/** 从 MAIL_FROM 取显示名。 */
function fromAlias(): string {
  return /^\s*([^<]+?)\s*</.exec(env.MAIL_FROM)?.[1]?.trim() ?? "解牛";
}

/**
 * 发登录验证码邮件。misconfig / 失败返回 false（不抛），
 * 调用方可回退到 dev 环境打印验证码。
 */
export async function sendVerificationEmail(
  to: string,
  code: string,
): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.request(
      "SingleSendMail",
      {
        RegionId: env.ALI_REGION,
        AccountName: senderAddress(),
        AddressType: 1,
        ReplyToAddress: false,
        ToAddress: to,
        Subject: "【解牛】登录验证码",
        FromAlias: fromAlias(),
        HtmlBody: `<p>你的解牛登录验证码：<b style="font-size:20px">${code}</b></p><p>10 分钟内有效；如非本人操作请忽略。</p>`,
      },
      { method: "POST" },
    );
    return true;
  } catch (e) {
    console.error(
      "[email] Aliyun DirectMail send failed:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}
