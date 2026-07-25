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
  env NODE_ENV=production PORT=3838 \
      MAIL_FROM="解牛 <noreply@mail.auramate.net>" ALI_REGION=cn-hangzhou \
      nohup npm run start > /Users/mac/jieniu-prod.log 2>&1 & disown
```

**build 与 start 必须分两步跑**，别用 `;` 串成一条：build 失败时 `;` 照样往下执行，
线上会被杀掉又用坏构建拉起来。脚本本身不做 build，就是为了守住这条。

启动后日志第一行 `[boot] ✓ 密钥齐全` 表示密钥进了进程；`[boot] ✗ 缺少密钥 …` 说明启动方式不对，
脚本会以非 0 退出。

## 注意

- **不抗重启**：没上 launchd，Mac 重启后需手动重启生产服务器 + 确认 rathole client 在跑（policy：持久守护进程要明确要求才做）。
- 证书续期每 ~3 月会把 privkey 重置为 600 → 需重新 `sudo chmod 640 /etc/letsencrypt/archive/jieniu.swaylab.ai/privkey1.pem`（或写 renewal-hook）。
- 数据库连接：`postgresql://mac@localhost:5432/jieniu`（本地 trust，无密码）。
