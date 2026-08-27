# 解牛迁移国内（jieniu.club）运行手册

> 目标：把 jieniu 从「本机 Mac + rathole 隧道 → 日本 VPS → Caddy」迁到「阿里云国内 ECS + ESA 边缘加速」。
> 域名换成已备案的 **jieniu.club**（apex + www）。旧域名 `jieniu.swaylab.ai` 验证通过前保持服务，之后 301 到新域名。

## 已核实（2026-08-27 实测）

- [x] AK：`ALI_KEY`/`ALI_SECRET`，对 **ESA**（ListSites）和**万网 DNS**（AddDomainRecord / DescribeDomainRecords）都有权限。
- [x] 域名：`jieniu.club` NS = `dns19/dns20.hichina.com`（万网，同一阿里云账号）。
- [x] ESA 账号：已有 `auramate.com.cn` 站点（siteId `167661595965656`，基础版）。`jieniu.club` 需**新建站点 + 新基础版实例**（计费）。
- [x] ESA/Alidns 调用器：`projects/esa-acceleration/tool/esa.js`（camelCase 输出）。
- [x] **ESA 基础版价格**（`DescribeRatePlanPrice`，planName=basic，coverage 同价）：**¥9.9/月**（totalPrice；`price`+`discountPrice` 两项之和），年付 ¥118.8（12 期无额外折扣），50 流量单位（待确认 GB），PREPAY、autoPay。规则「基础版1个月~6个月优惠」。

## 已定

- 架构 = **真·国内**：jieniu 全套跑在 `aliyun-main`（47.99.195.191，7.1G 内存 / 40G 盘 / 4 核 / Ubuntu 26.04）。
- SSH：alias `aliyun-main`；sudo 密码在 secret store `ALIYUN_MAIN_SUDO_PW`。
- AK：`ALI_KEY`/`ALI_SECRET`；服务器 secrets 在 `/etc/jieniu/env`（600，root 写、ubuntu 读）。

## ECS 侧（A/B/C 已完成）

- [x] 环境：Node 22.22.1、pm2 7.0.4（registry npmmirror）、**PostgreSQL 18.6**（Ubuntu 26.04 apt 无 PG17）、nginx 1.28.3、certbot 4.0.0、git。
- [x] 库：`jieniu` 库 + 专用用户；`pg_restore` 后 **33 张表与源一致**（`LC_ALL=C sort` 复核）。
- [x] 头像：`var/avatars/` 1 个文件已同步（4146B 一致）。
- [x] 代码：`/home/ubuntu/jieniu`（HEAD 5f49cc4）→ `npm install --include=dev`（npmmirror）→ `NODE_ENV=production npm run build` exit 0（next-server v15.5.20）。
- [x] 启动脚本：`scripts/start-prod-ecs.sh`（**lsof 已换成 fuser**——ECS 上 lsof 返回空，fuser 正常）、`scripts/start-scheduler-ecs.sh`（pm2）。
- [x] 进程：web `127.0.0.1:3838` `[boot] ✓ 密钥齐全｜手机号登录 ✓（执楠科技）｜问解牛 → openai/gpt-5.6-terra`；scheduler `jieniu-scheduler` `已加载 11 条任务`。
- [x] **源站 nginx vhost `jieniu.club`**：80 → 301 https；443 → `http://127.0.0.1:3838`（X-Forwarded-Proto https、`proxy_buffering off` 保 SSE 流式）。LE 证书 `jieniu.club`+`www`（2026-11-25 到期，自动续期），HTTP-01 已验。
- [x] 万网临时/回滚 A 记录：`@`→47.99.195.191（recordId `2092880341454680064`）、`www`→同 IP（recordId `2092880344785053696`）。**当前 jieniu.club 已直连源站、https 200**，go-live 时改成 CNAME（这两个 recordId 即回滚/切换手柄）。

## ESA 侧（D 已做到只剩一条手点 + 切流量）

已确认的实例/site 标识：

- instanceId **`esa-site-bpvhczfjf6yo`**（基础版，orderId `2002431542140564`，¥9.9/月 sway 已确认）。
- siteId **`175039747977456`**，status **active**，cnameZone **`a1.initgg.com`**。

已完成：

1. [x] `PurchaseRatePlan`（basicplan/basic/domestic/PREPAY/1 月/autoPay/autoRenew）。
2. [x] `CreateSite` → siteId 175039747977456。
3. [x] 万网 `_esaauth` TXT（recordId `2092881369285733376`）→ `VerifySite` passed。
4. [x] `UpdateOriginRule`（global configId `515712535879689`，dnsRecord=""、originScheme=https、originHost/originSni=jieniu.club、originVerify=on）。
5. [x] 缓存规则 ×4（dynamic-bypass / next-static / next-image / static-assets）+ 静态删 Set-Cookie（`static-del-setcookie`）。
6. [x] 边缘证书：源站 LE 证书上传（`esa-setcert.js`，certId `babafd3c47fc489fbb184ab9d5015bab`，零窗口）。

已完成（go-live，2026-08-27 实测）：

- [x] sway 控制台手点 `@`/`www` 两条 A → 47.99.195.191、代理开（recordCname `jieniu.club.a1.initgg.com` / `www.jieniu.club.a1.initgg.com`）。
- [x] 边缘灰度（`--resolve`）：首页 DYNAMIC、`/_next/static/*.css` 二次 HIT、`/api` DYNAMIC。
- [x] 万网 `@`/`www` A → CNAME 指 ESA（recordId `2092880341454680064`/`2092880344785053696`；回滚=改回 A）。公网 8.8.8.8 已见 ESA 边缘 IP。
- [x] 证书：`ApplyCertificate`（apex+www，free，HTTP-01，status OK，ESA 托管自动续期）；已删 snapshot 上传证书与 apex-only 冗余证书。线上 wire 证书 SAN=apex+www、notAfter 2026-11-25 07:03（自动续）。
- [x] 真链路（自动部分）：`https://jieniu.club`/`www` 200、静态 HIT、scheduler `ingest`/`backfill-announcements`/`daily-digest`/`alert-generate` 全部 ok（**无 OpenRouter 403**，daily-digest 587s LLM 全程跑完 → 国内出网正常）。

登录态无缝迁移（2026-08-27 已上线、逻辑级验证全过，commit `ac7face`）：

- 会话是 JWT、两端同一把 AUTH_SECRET，cookie 只认域名；用一次性令牌握手绕过。4 个文件：`src/lib/session-migrate.ts`（常量）、`src/middleware.ts`（老域名页面 → `/api/auth/migrate-start`）、`src/app/api/auth/migrate-start/route.ts`（老域名已登录签发 60s 令牌）、`src/app/api/auth/migrate/route.ts`（新域名消费重签 30 天 cookie）。
- **回跳地址必须钉死 NEW_ORIGIN**：nginx 回源下 Next 把 origin 探成 `localhost:3838`，从 `req.url` 推导会 303 到 `https://localhost:3838/...` 打不开。
- 已验证：伪造老域名会话 → migrate-start 302 带 token → migrate 303 落新域名页 + 30 天 cookie 可解码同 sub；垃圾 token 400；未登录直跳首页；真实老域名 middleware 302 正常。
- 坑：Next 序列化 `SameSite=lax` 是小写；undici fetch 测 middleware 会覆盖 Host，得用 `curl -H Host:`。

待办（E/F，sway）：

- [ ] **sway 真交互验证**：邮箱 OTP 真发（登录收码）、问解牛对话、移动端/PWA、头像显示。
- [ ] 旧域名 `jieniu.swaylab.ai` → 301 `https://jieniu.club`。**注意**：301 放边缘（Caddy/nginx redir）会绕过上面的登录握手 → 老域名 cookie 带不过去、用户得重登一次；要保登录态就让老域名继续回源到应用、由 middleware 做带握手的 302 跳转，过一段再硬 301。（等 sway 定）
- [ ] ECS 重启不自拉起（web nohup、scheduler pm2 `disabled`）——要 `pm2 startup`/systemd 再明确要求。

## 注意

- **origin 证书续期**：go-live 后 jieniu.club 走 ESA，HTTP-01 续期请求会经 ESA 回源到 nginx 的 `/.well-known/acme-challenge/`（动态、不缓存），理论可行，go-live 后实测一次；不行再切 DNS-01。
- lsof 在 aliyun-main 上坏（返回空），排查端口一律用 `fuser <port>/tcp`。
- PostgreSQL 18（非 17），Prisma 6.6 已实际连库成功（web/scheduler 都在跑），无需处理。
