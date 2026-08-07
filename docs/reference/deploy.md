# 解牛 部署运行手册

**线上**：https://jieniu.swaylab.ai （2026-07-02 首次部署）

## 架构

公网 443（VPS 上 xray）→ Caddy `:8443`（`jieniu.swaylab.ai`）→ `reverse_proxy localhost:4025` → rathole 隧道 → 本机 Mac `127.0.0.1:3838` → Next.js（`next start`）→ 本机 PostgreSQL 17（`jieniu` 库）

## 关键参数

- 本机端口：**3838**（生产 `next start`）
- rathole 数据端口（VPS）：**4025**，服务名 `jieniu`
- VPS：`ubuntu@45.89.234.110`，Caddy + certbot（证书 `/etc/letsencrypt/live/jieniu.swaylab.ai/`，2026-09-30 到期，自动续期）
- rathole client：共享 `/Users/mac/claudeclaw/asst/rathole/client.toml`（已追加 `[client.services.jieniu]`，hot-reload）
- rathole server：VPS `~/rathole/server.toml`（已追加 `[server.services.jieniu]` → 4025，hot-reload）
- 生产日志：`/Users/mac/jieniu-prod.log`

## 依赖（任一挂了站点就下线）

1. 本机 Mac 开机
2. 本机 PostgreSQL 服务（`brew services list` 看 `postgresql@17`）
3. 生产服务器进程（nohup，端口 3838）
4. rathole client（Mac 上共享进程）+ VPS 上 Caddy / rathole server

## 重启生产服务器

```bash
cd /Users/mac/claudeclaw/finance-agent/projects/jieniu
NODE_ENV=development npm install --include=dev   # 依赖有变时（NODE_ENV=production 会漏装 devDeps）
NODE_ENV=production npm run build                 # 代码有变时；必须 exit 0 才往下走
scripts/start-prod.sh                             # 停旧进程 → secret exec 注入密钥 → 起 → 自检
```

**只用 `scripts/start-prod.sh` 启动，别手敲 `npm run start`。** `ALI_KEY` / `ALI_SECRET` /
`OPENROUTER_API_KEY` 不在 `.env` 里，只在 `secret` store 里，全靠脚本里的 `secret exec` 注入。
裸起进程照样监听 3838、首页照样 200，但这三个 key **静默**缺失 —— AI 全线（问解牛 / 解读 /
thesis / drift / 画像 / 事件摘要）每次调用秒失败，登录验证码也发不出去。2026-07-25 的事故就是这么来的。

脚本等价于（自检部分从略）：

```bash
lsof -ti:3838 | xargs kill 2>/dev/null
secret exec ALI_KEY ALI_SECRET OPENROUTER_API_KEY -- \
  env NODE_ENV=production PORT=3838 OPENROUTER_ASK_MODEL=openai/gpt-5.4-mini \
      MAIL_FROM="解牛 <noreply@mail.auramate.net>" ALI_REGION=cn-hangzhou \
      nohup npm run start > /Users/mac/jieniu-prod.log 2>&1 & disown
```

**build 与 start 必须分两步跑**，别用 `;` 串成一条：build 失败时 `;` 照样往下执行，
线上会被杀掉又用坏构建拉起来。脚本本身不做 build，就是为了守住这条。

启动后日志第一行 `[boot] ✓ 密钥齐全` 表示密钥进了进程；`[boot] ✗ 缺少密钥 …` 说明启动方式不对，
脚本会以非 0 退出。

### 模型分档与 OpenRouter 账号（2026-08-05）

问解牛跑 `openai/gpt-5.4-mini`（由 `OPENROUTER_ASK_MODEL` 指定），其余 AI 跑
`deepseek/deepseek-chat`。**两档共用同一把 `OPENROUTER_API_KEY`**，不需要第二把 key。

一段账号史，别再重踩：当天早些时候的**旧** key 对 `openai/*` `anthropic/*` `google/*`
一律 403 provider ToS（`deepseek/*` `meta-llama/*` 正常）。挡的是三家美国大厂、不是 OpenAI 单家；
**限制绑在账号的注册/结算地区上、不看请求 IP**——同一把旧 key 从日本 VPS 打也是 403，
上代理/换机房绕不开。sway 当天换上新账号那把，三家全通。

> `403 provider ToS` 这句文案既不区分账号也不区分 provider。要判它的边界，
> **必须逐个 provider + 换个地点各打一遍**，否则容易把「受限」当成「废了」而误删。

- 万一将来主 key 又打不了 GPT：设 `OPENROUTER_ASK_API_KEY` 指到另一个账号即可，代码不用动。
- GPT 打不开时 `server/ask-model.ts` 的候选链会**静默**退回 DeepSeek——功能正常、答得差一档、
  零报错。所以 `[boot]` 行会打「问解牛 → 哪个模型」。
- 判断线上到底跑在哪一档：`grep '^\[boot\]' /Users/mac/jieniu-prod.log`，
  以及 `grep '^\[ask\]' /Users/mac/jieniu-prod.log` 看有没有降级记录。

## 注意

- **不抗重启**：没上 launchd，Mac 重启后需手动重启生产服务器 + 确认 rathole client 在跑（policy：持久守护进程要明确要求才做）。
- 证书续期每 ~3 月会把 privkey 重置为 600 → 需重新 `sudo chmod 640 /etc/letsencrypt/archive/jieniu.swaylab.ai/privkey1.pem`（或写 renewal-hook）。
- 数据库连接：`postgresql://mac@localhost:5432/jieniu`（本地 trust，无密码）。
- **用户上传的头像是本机文件**：`var/avatars/<userId>.webp`（gitignore，也不在数据库里）。
  库里只存 `User.image` 这个指向 `/api/avatar/<id>?v=<哈希>` 的相对 URL。
  换机 / 重装 / 只恢复数据库 → 头像文件全丢，界面会退回默认渐变头像（不报错，`<img>`
  拉 404 后有兜底）。要连头像一起备份就把 `var/` 一并打包。目录可用 `AVATAR_DIR` 挪走。

## 定时任务（服务内调度器）

9 条数据管线由 `jieniu-scheduler`（pm2）派发，不再依赖 hermit-ui 的 `/cron`。
任务声明在 `src/scheduler/jobs.ts`（唯一配置来源），运行记录看 `/admin/jobs`。
设计稿 `docs/specs/2026-07-29-in-service-scheduler.md`。

**启停**

- 启动 / 重启：`scripts/start-scheduler.sh` —— **唯一入口**。
  它先 `pm2 delete` 再 `pm2 start`，因为 **`pm2 restart` 不会重新读环境变量**，
  直接 restart 会静默丢掉 `secret exec` 注入的三个密钥（AI 任务全部 skipped、告警信发不出），
  正是 7-25 事故的形状。
- 收件人：取自 secret store 的 `OPS_ALERT_EMAIL`，由 `start-scheduler.sh` 的 `secret exec` 注入
  （本仓在 GitHub 公开，别把邮箱写进文件）。换收件人：
  `printf %s 'you@example.com' | secret set OPS_ALERT_EMAIL` 后重跑 `scripts/start-scheduler.sh`。
  没设时脚本会打 `⚠ secret store 里没有 OPS_ALERT_EMAIL`，此时告警只落 `JobRun`、不发信。
  不设就只落库不发信，脚本会警告一行。
- 状态：`pm2 list` / `pm2 logs jieniu-scheduler --lines 50`
- 日志：`/Users/mac/jieniu-scheduler.log`（每次启动清空）

**改了代码之后**

worker 与 web 是两个进程。改了 `src/server/*` 或 `src/scripts/*` 之后 **两个都要重启**：

```
NODE_ENV=production npm run build     # exit 0 之后才继续
scripts/start-prod.sh
scripts/start-scheduler.sh
```

只重启一个会让两边跑不同版本的共享代码。

**启停单条任务**

`enabled` 存在 `JobState` 表里（`/admin/jobs` 是只读的，超管落地前不提供按钮）。
**新任务落库时一律 `enabled=false`**——worker 把「从未跑过」判为立即到期，
默认启用会在第一次启动就把 9 条管线一起拉起来。

```bash
DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx -e 'void (async () => {
  const { PrismaClient } = await import("./generated/prisma");
  const db = new PrismaClient();
  await db.jobState.update({ where: { key: "ingest" }, data: { enabled: true, nextFire: null } });
  await db.$disconnect();
})();'
```

（`tsx -e` 的 eval 走 cjs、**不支持顶层 await**，所以要包成 async IIFE。）

**排查**

- 任务没跑：先看 `JobState.enabled` 和 `nextFire`，再看 `runningAt` 是不是卡住了
  （超过该任务总 timeout 两倍会在下一个 tick 自动释放）。
- 任务标 `skipped`：多半是缺密钥。`grep '\[scheduler\]' /Users/mac/jieniu-scheduler.log`
  看启动自检行；`✗ 缺少密钥` = 没走启动脚本。
- 任务标 `timeout`：默认 45 分钟，`backfill-signals` 30、`generate-market-digest` 60，
  在 `jobs.ts` 里按步覆盖。
- AI 小结写的是废话：先看 `JobRun.metrics` 有没有环比数据，别去松提示词
  （「AI 写的都是正确的废话」根因在喂进去的数据）。
- 判据阈值全在 `jobs.ts` 的 `checks` 里，改阈值前先确认是阈值不合时宜、不是真的回归了。
