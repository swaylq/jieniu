import Core from "@alicloud/pop-core";
import { env } from "~/env";
import { normalizePhone } from "~/lib/phone";

/**
 * 阿里云短信（Dysmsapi）验证码发送。结构照 `server/email.ts`——同一对 AK 既发邮件也发短信。
 *
 * 背景：张楚寒转述她爹 2026-07-31「登陆怎么还要邮箱啊」「手机号登陆不好吗」。
 * 对不常用邮箱的用户（尤其长辈），邮箱验证码这一步就是劝退。
 *
 * **签名与模板必须是已过审的**（国内短信强制报备）。实测该账号已有：
 *   签名：执楠科技 / 上海执楠信息科技 / live这一刻（均 AUDIT_STATE_PASS）
 *   模板：SMS_501775398「尊敬的用户，您的注册验证码为：${code}，5分钟内有效，请勿泄露！」
 * 二者都走环境变量，换签名/模板不用改代码。
 *
 * ⚠ 模板别照着 `QuerySmsTemplateList` 挑：该账号列出的 4 个模板全是 AUDIT_STATE_PASS，
 * 但 SendSms 只认 SMS_501775398，其余报「该账号下找不到对应模板」——
 * 列表接口与发送接口在阿里云这边不是同一份账本。换模板前必须真发一条验。
 */
let client: Core | null = null;

function getClient(): Core | null {
  if (!env.ALI_KEY || !env.ALI_SECRET) return null;
  client ??= new Core({
    accessKeyId: env.ALI_KEY,
    accessKeySecret: env.ALI_SECRET,
    // 短信只有杭州这一个通用接入点，与邮件的 region 无关，别跟着 ALI_REGION 走
    endpoint: "https://dysmsapi.aliyuncs.com",
    apiVersion: "2017-05-25",
  });
  return client;
}

export function smsConfigured(): boolean {
  return !!(env.ALI_KEY && env.ALI_SECRET && env.ALI_SMS_SIGN_NAME);
}

/**
 * 发登录验证码短信。misconfig / 失败返回 false（**不抛**），调用方据此决定
 * 是删码报错（生产）还是回退到打印验证码（开发）——与邮件那条完全同构。
 *
 * 阿里云的失败是「HTTP 200 + Code != OK」，不是抛异常：只 catch 不看 Code
 * 会把「余额不足」「模板未审核」「号码黑名单」全当成发送成功，用户空等一个从没发出的码。
 */
export async function sendVerificationSms(
  to: string,
  code: string,
): Promise<boolean> {
  const c = getClient();
  if (!c || !env.ALI_SMS_SIGN_NAME) return false;
  try {
    const r: { Code?: string; Message?: string } = await c.request(
      "SendSms",
      {
        PhoneNumbers: normalizePhone(to),
        SignName: env.ALI_SMS_SIGN_NAME,
        TemplateCode: env.ALI_SMS_TEMPLATE_CODE,
        TemplateParam: JSON.stringify({ code }),
      },
      { method: "POST" },
    );
    if (r.Code !== "OK") {
      // **只打错误码与文案，绝不打手机号或验证码**
      console.error(`[sms] Aliyun SendSms rejected: ${r.Code} ${r.Message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(
      "[sms] Aliyun SendSms failed:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}
