import { PrismaClient } from "../../generated/prisma";
import { generateAlertEvents } from "../server/alert-outbox";
import { sendAlertEmails, baseUrl } from "../server/alert-mailer";

/**
 * 提醒投递（2026-07-28）：生成 Outbox 事件 → 按需发异动邮件。
 *
 * 用法（邮件必须带密钥，密钥只在 secret store）：
 *   env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" SKIP_ENV_VALIDATION=1 \
 *     npx tsx src/scripts/alert-dispatch.ts --generate
 *   secret exec ALI_KEY ALI_SECRET -- env DATABASE_URL="…" SKIP_ENV_VALIDATION=1 \
 *     npx tsx src/scripts/alert-dispatch.ts --email
 *
 * 参数：
 *   --generate  只生成事件（幂等，可随 ingest 每轮跑）
 *   --email     生成 + 发邮件（免打扰时段自动跳过）
 *   --dry       不写不发，只打印将要做什么
 *   --user=<id> 只处理某个用户
 *   --window=N  生成窗口小时数（默认 48）
 */
const db = new PrismaClient();

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function opt(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p?.slice(name.length + 3);
}

async function main() {
  const dry = flag("dry");
  const wantEmail = flag("email");
  // 不给动作参数时默认只生成——别默认发信。
  const wantGenerate = flag("generate") || !wantEmail;
  const userArg = opt("user");
  const userIds = userArg ? [userArg] : undefined;
  const windowHours = opt("window") ? Number(opt("window")) : undefined;

  console.log(
    `[alert-dispatch] 开始｜生成=${wantGenerate} 邮件=${wantEmail} dry=${dry} base=${baseUrl()}`,
  );

  if (wantGenerate) {
    if (dry) {
      console.log("[alert-dispatch] (dry) 跳过生成——dry 模式不写库");
    } else {
      const s = await generateAlertEvents(db, { userIds, windowHours });
      console.log(
        `[alert-dispatch] 生成：用户 ${s.users}｜草稿 ${s.drafted}｜新建 ${s.created}｜去重挡下 ${s.duplicate}`,
      );
    }
  }

  if (wantEmail) {
    const m = await sendAlertEmails(db, { dryRun: dry, userIds });
    if (m.skippedQuiet) {
      console.log("[alert-dispatch] 邮件：免打扰时段，未投递");
    } else {
      console.log(
        `[alert-dispatch] 邮件：候选 ${m.candidates} 条｜发出 ${m.sent} 封｜失败 ${m.failed} 封`,
      );
      if (m.failed > 0) {
        throw new Error(`有 ${m.failed} 封发送失败——检查 ALI_KEY / ALI_SECRET 与发信地址校验`);
      }
    }
  }

  console.log("[alert-dispatch] 完成");
}

main()
  .catch((e) => {
    console.error("[alert-dispatch] 失败:", e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
