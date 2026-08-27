# 解牛 部署运行手册

**线上**：https://jieniu.club （2026-08-27 国内上线，阿里云 ESA 边缘加速）
**旧域名**：https://jieniu.swaylab.ai —— 验证通过后 301 到新域名（回退路径，暂保留）。

迁移全过程见 `docs/reference/migrate-domestic.md`。

## 架构（真·国内）

```
用户 → ESA 边缘（国内节点，静态缓存 + 免费证书 apex+www 自动续期）
    → 万网 CNAME：jieniu.club → jieniu.club.a1.initgg.com（ESA cnameZone a1.initgg.com）
    → ESA 回源 https://47.99.195.191:443（originHost/originSni = jieniu.club）
    → aliyun-main nginx（vhost jieniu.club）→ 127.0.0.1:3838
    → Next.js（next start）→ 本机 PostgreSQL 18（jieniu 库）
```

- ESA siteId **`175039747977456`**，instanceId `esa-site-bpvhczfjf6yo`（基础版 ¥9.9/月）。
- ECS：`ubuntu@47.99.195.191`（ssh alias `aliyun-main`，sudo 在 secret store `ALIYUN_MAIN_SUDO_PW`）。
- 代码：`/home/ubuntu/jieniu`（git clone）。
- 密钥：`/etc/jieniu/env`（600，root 写、ubuntu 读）—— DATABASE_URL / AUTH_SECRET / ALI_KEY / ALI_SECRET / OPENROUTER_API_KEY / OPS_ALERT_EMAIL。
- 数据库：`postgresql://jieniu:<pw>@localhost:5432/jieniu`（pw 在 `/etc/jieniu/env`）。
- 源站 nginx 证书：`/etc/letsencrypt/live/jieniu.club/`（certbot 自动续期，HTTP-01 经 ESA 回源到 `/.well-known/acme-challenge/`）。

## 关键参数

- 本机端口：**3838**（`next start`）。
- 生产日志：`/home/ubuntu/jieniu-prod.log`；scheduler 日志：`/home/ubuntu/jieniu-scheduler.log`。
- ESA 回源：`UpdateOriginRule`（global configId `515712535879689`）：dnsRecord 留空、https、host/sni=jieniu.club。
- 缓存规则 ×4 + 静态删 Set-Cookie（`static-del-setcookie`）—— 已配，见 migrate-domestic.md。

## 重启生产服务器（ECS）

```bash
ssh aliyun-main
cd /home/ubuntu/jieniu
git pull                                              # 代码有变时
NODE_ENV=development npm install --include=dev        # 依赖有变时（production 会漏装 devDeps）
NODE_ENV=production npm run build                     # 代码有变时；必须 exit 0 才往下走
scripts/start-prod-ecs.sh                             # 读 /etc/jieniu/env → 停旧 → 起 → 自检
```

**只用 `scripts/start-prod-ecs.sh` 启动，别手敲 `npm run start`。** 密钥不在 `.env`，在
`/etc/jieniu/env`（脚本 `set -a; . /etc/jieniu/env` 读入）。裸起进程照样 200，但 AI 全线 +
登录验证码静默缺失——2026-07-25 的事故就是这么来的（当时是漏 `secret exec`，现在是漏 env）。

**build 与 start 必须分两步**，别用 `;` 串成一条：build 失败时 `;` 照样往下执行，线上会被杀
又用坏构建拉起来。

启动后日志第一行 `[boot] ✓ 密钥齐全` 表示密钥进进程；`[boot] ✗` 说明启动方式不对，脚本非 0 退出。

> ECS 上 `lsof` 是坏的（返回空），脚本里查端口一律用 `fuser <port>/tcp`。

### 模型分档与 OpenRouter 账号（2026-08-05）

问解牛跑 `openai/gpt-5.6-terra`（`OPENROUTER_ASK_MODEL`），其余 AI 跑 `deepseek/deepseek-chat`。
**两档共用同一把 `OPENROUTER_API_KEY`**。

- 旧 key 对 `openai/*` `anthropic/*` `google/*` 一律 403 provider ToS（`deepseek/*` `meta-llama/*`
  正常）。**限制绑在账号注册/结算地区、不看请求 IP**——同账号从日本 VPS 打也是 403，换机房绕不开。
  判断 `403 provider ToS` 的边界要**逐个 provider + 换个地点各打一遍**。
- GPT 打不开时 `server/ask-model.ts` 候选链**静默**退回 DeepSeek（答得差一档、零报错），
  所以 `[boot]` 行会打「问解牛 → 哪个模型」。
- 判断线上跑哪档：`grep '^\[boot\]' /home/ubuntu/jieniu-prod.log`，降级看 `grep '^\[ask\]'`。

## 定时任务（服务内调度器）

11 条数据管线由 `jieniu-scheduler`（pm2）派发，任务声明在 `src/scheduler/jobs.ts`（唯一配置来源），
运行记录看 `/admin/jobs`。设计稿 `docs/specs/2026-07-29-in-service-scheduler.md`。

**启停**

- 启动 / 重启：`scripts/start-scheduler-ecs.sh` —— **唯一入口**。先 `pm2 delete` 再 `pm2 start`
  （`pm2 restart` 不重读环境变量，会静默丢密钥）。
- 收件人：`/etc/jieniu/env` 里的 `OPS_ALERT_EMAIL`。没设时告警只落 `JobRun`、不发信。
- 状态：`pm2 list` / `pm2 logs jieniu-scheduler --lines 50`
- 日志：`/home/ubuntu/jieniu-scheduler.log`（每次启动清空）

**改了代码之后**：worker 与 web 是两个进程，改 `src/server/*` / `src/scripts/*` 后**两个都要重启**
（build → `start-prod-ecs.sh` → `start-scheduler-ecs.sh`）。

**启停单条任务**：`enabled` 在 `JobState` 表（`/admin/jobs` 只读）。新任务落库一律 `enabled=false`
（worker 把「从未跑过」判为立即到期）。

```bash
ssh aliyun-main
set -a; . /etc/jieniu/env; set +a
cd /home/ubuntu/jieniu
DATABASE_URL="$DATABASE_URL" npx tsx -e 'void (async () => {
  const { PrismaClient } = await import("./generated/prisma");
  const db = new PrismaClient();
  await db.jobState.update({ where: { key: "ingest" }, data: { enabled: true, nextFire: null } });
  await db.$disconnect();
})();'
```

**排查**

- 任务没跑：先看 `JobState.enabled` / `nextFire`，再看 `runningAt` 是否卡死。
- `skipped`：多半缺密钥，`grep '\[scheduler\]' /home/ubuntu/jieniu-scheduler.log`。
- `timeout`：默认 45 分钟，`backfill-signals` 30、`generate-market-digest` 60，在 `jobs.ts` 覆盖。
- AI 小结是废话：先看 `JobRun.metrics` 环比数据，别去松提示词。
- 判据阈值全在 `jobs.ts` 的 `checks`。

## 注意

- **ECS 重启不自拉起**：web 是 nohup、scheduler 的 pm2 autostart 是 `disabled`。ECS 重启后需手动
  `scripts/start-prod-ecs.sh` + `scripts/start-scheduler-ecs.sh`（要持久守护再明确要求）。
- **头像本机文件**：ECS 上 `var/avatars/<userId>.webp`（gitignore、不在库里）。库里只存
  `User.image` 指向 `/api/avatar/<id>?v=<哈希>`。丢头像会退回默认渐变，不报错。备份要连 `var/` 一起。
- **证书三层**：① ESA 边缘免费证书（apex+www，ESA 托管自动续期，`ListCertificates` 看）；② 源站
  nginx LE 证书（certbot 自动续期）；③ 不用手动上传——go-live 前的 snapshot 证书已删。
- **缓存**：静态 `/_next/static` HIT、`/api` DYNAMIC、HTML 不缓存（`x-site-cache-status` 头看）。
  基础版共享边缘缓存容量小，冷对象会被 LRU 挤掉回源——靠真实流量升温，别指望全 HIT。

## 旧架构（jieniu.swaylab.ai，回退/收尾）

公网 443（VPS xray）→ Caddy `:8443` → `localhost:4025` → rathole → 本机 Mac `127.0.0.1:3838`。
依赖本机 Mac + PostgreSQL 17 + rathole + VPS Caddy。收尾（旧域名 301 → jieniu.club）后此段下线。
