// 手机号的归一与校验（张楚寒转述她爹 2026-07-31：「登陆怎么还要邮箱啊」「手机号登陆不好吗」）。
// 纯逻辑、无 IO、可测。
//
// 只做**中国大陆**号码：解牛是 A 股产品，用户在境内；开放国际号会把校验放松成
// 「11 位以上数字」，那等于没有校验，验证码会被打到随便什么号上（短信是要花钱的，
// 而且骚扰真人的成本由被骚扰的人承担）。

/** 中国大陆手机号：1 开头，第二位 3-9，共 11 位。 */
const CN_MOBILE = /^1[3-9]\d{9}$/;

/**
 * 归一：剥掉空格 / 短横 / 括号 / +86 / 86 前缀。
 * 用户手输、从通讯录粘贴、从别处复制，长相千奇百怪——「+86 138-0013-8000」和
 * 「13800138000」必须是同一个人，否则同一个号会建出两个账号。
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-()（）]/g, "").replace(/^\+?86/, "");
  return digits;
}

export function isValidPhone(raw: string): boolean {
  return CN_MOBILE.test(normalizePhone(raw));
}

/**
 * 打码展示：`138****8000`。回执里要让用户确认「发到哪个号了」，
 * 但整串回显没必要——页面可能被旁人看到，而他自己看前三后四就够认了。
 */
export function maskPhone(raw: string): string {
  const p = normalizePhone(raw);
  if (!CN_MOBILE.test(p)) return p;
  return `${p.slice(0, 3)}****${p.slice(7)}`;
}

/**
 * 验证码存取用的 identifier。**必须加前缀**：`VerificationToken.identifier`
 * 是邮箱与手机号共用的一列，不加前缀的话，一个恰好长得像手机号的邮箱本地部分
 * （或将来别的登录方式）会和真手机号撞进同一行。
 */
export function phoneIdentifier(raw: string): string {
  return `phone:${normalizePhone(raw)}`;
}
