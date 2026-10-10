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
scripts/start-prod-ecs.sh                             # 配置预检 → PM2 更新 web → 自检 → 保存
```

**只用 `scripts/start-prod-ecs.sh` 启动，别手敲 `npm run start`。** 密钥不在 `.env`，在
`/etc/jieniu/env`（脚本 `set -a; . /etc/jieniu/env` 读入）。裸起进程照样 200，但 AI 全线 +
登录验证码静默缺失——2026-07-25 的事故就是这么来的（当时是漏 `secret exec`，现在是漏 env）。

**build 与 start 必须分两步**，别用 `;` 串成一条：build 失败时 `;` 照样往下执行，线上会被杀
又用坏构建拉起来。

启动后日志第一行 `[boot] ✓ 密钥齐全` 表示密钥进进程；`[boot] ✗` 说明启动方式不对，脚本非 0 退出。

### 网页进程自动恢复（2026-10-10）

Web 由 PM2 的 `jieniu-web` 托管，配置为 `scripts/ecosystem-prod-ecs.config.cjs`。
`run-prod-ecs.sh` 在每次启动时读取 `/etc/jieniu/env`，并用 `exec` 启动 Next.js；
PM2 直接监控实际网页进程，异常退出后自动重启。进程总内存超过 **1536 MiB** 时，
PM2 在下一次内存检查时重启（通常约 30 秒），早于原来约 2 GiB 的 JavaScript 堆耗尽。
这是故障恢复保护，不代表已定位长期内存增长的代码来源。

- 启动与部署仍只用 `scripts/start-prod-ecs.sh`；`--check-env` 只检查配置、构建和依赖。
- 日志保持追加，启动自检只读本次新增部分；不得把旧日志的成功行当成本次成功。
- 首次迁移只停止工作目录和进程名匹配的旧 Next.js 进程，之后仅更新 `jieniu-web`。
- 临时验收可指定 `NAME`、`PORT`、`LOG` 和 `PM2_SAVE=0`，结束后删除该临时 PM2 项。
- 2026-10-08 崩溃日志保存在 `var/ops/502-20261010/jieniu-prod.before.log`；读取时用
  `tail -c` 限制字节数，不能一次性载入整份数 GB 日志。

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

- **ECS 开机恢复**：2026-10-10 已用 PM2 的 `startup systemd -u ubuntu --hp /home/ubuntu`
  注册并启用 `pm2-ubuntu`，通过保存的进程清单恢复 web 与 scheduler。
  `systemctl is-enabled pm2-ubuntu` 应返回 `enabled`；新增/删除正式进程后要 `pm2 save`。
  这次没有重启 ECS，开机恢复仅验证服务配置和保存清单。
- **头像本机文件**：ECS 上 `var/avatars/<userId>.webp`（gitignore、不在库里）。库里只存
  `User.image` 指向 `/api/avatar/<id>?v=<哈希>`。丢头像会退回默认渐变，不报错。备份要连 `var/` 一起。
- **证书三层**：① ESA 边缘免费证书（apex+www，ESA 托管自动续期，`ListCertificates` 看）；② 源站
  nginx LE 证书（certbot 自动续期）；③ 不用手动上传——go-live 前的 snapshot 证书已删。
- **缓存**：静态 `/_next/static` HIT、`/api` DYNAMIC、HTML 不缓存（`x-site-cache-status` 头看）。
  基础版共享边缘缓存容量小，冷对象会被 LRU 挤掉回源——靠真实流量升温，别指望全 HIT。

## 本机运行配置（2026-10-10）

`scripts/start-prod.sh` / `scripts/start-scheduler.sh` 仅用于本机。共用的 `ALI_KEY`、
`ALI_SECRET`、`OPENROUTER_API_KEY` 继续由 `secret exec` 注入；项目根目录的 `.env`
保存 `AUTH_SECRET` 和普通配置 `OPS_ALERT_EMAIL`，权限必须为 600，且保持 Git 忽略。
两个变量已从本机全局库删除；不要再用 `secret set` / `secret exec` 管理它们。

本机需 Node 20.6+。Web 由 Next.js 读取 `.env`；调度器通过 Node 的
`--env-file` 读取，并传给实际 worker。启动前会检查配置，
`scripts/start-prod.sh --check-env` / `scripts/start-scheduler.sh --check-env`
只检查变量是否齐全，不输出值，也不启动或停止进程。

线上继续使用服务器的环境文件：国内 `/etc/jieniu/env`，海外 `/etc/jieniu-en/env`。
迁移只改变本机存放和读取方式，服务器上的值没有修改。

## 旧架构（jieniu.swaylab.ai，回退/收尾）

公网 443（VPS xray）→ Caddy `:8443` → `localhost:4025` → rathole → 本机 Mac `127.0.0.1:3838`。
依赖本机 Mac + PostgreSQL 17 + rathole + VPS Caddy。收尾（旧域名 301 → jieniu.club）后此段下线。
