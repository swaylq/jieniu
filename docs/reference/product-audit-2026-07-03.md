# 解牛 产品体检报告 · Product Audit

> **日期**：2026-07-03 ｜ **代码版本**：`9524583` ｜ **线上**：https://jieniu.swaylab.ai
> **评审视角**：产品经理 + 技术负责人（功能 / 数据 / 合规 / UI / 可访问性 / 性能全维度）
> **方法**：3 路并行代码审计（后端·数据·逻辑 / 功能·用户流程 / UI·设计系统）+ 真机多页面明暗双色走查（1440 / 768 / 440）

---

## 一、执行摘要

解牛目前是一个**功能完整、UI 精致的可用产品**（MVP → 完整化 → UI 重构 → 桌面端大改，四轮迭代），骨架扎实、无致命崩溃。但作为一次严肃体检，发现**一个 P0 安全漏洞**和**约 18 个 P1 缺陷**，其中数条**直接削弱产品的核心价值主张（"一手 + 聚焦 + 大师解读"）**——问题不在"做得不够多"，而在"已做的核心链路存在断点"。

### 🔴 最该先修的 5 件事（headline）

| # | 严重度 | 问题 | 为什么致命 |
|---|---|---|---|
| 1 | **P0** | **OTP 可被暴力破解 → 任意邮箱账号被盗** | 验证码 6 位、10 分钟有效、**无失败次数限制/锁定**，脚本可在有效期内穷举 100 万空间盗号 |
| 2 | **P1** | **媒体源永远达不到 importance≥55** | 华尔街见闻/东财/集微网（193+ 条里的大头）**永远进不了首页「重大动态」和通知**——占内容大头的一手快讯全部沉底 |
| 3 | **P1** | **数据管线无容错 + 单点** | 任一源抛错就中断整轮 ingest；调度是单台 Mac 上的离线脚本、无健康监测、重启不自恢复——"一手快讯"随时可能静默断流 |
| 4 | **P1** | **AI 解读接口无鉴权/限流** | `interpret.getOrCreate` 是 public mutation，可被枚举 `newsId×5 persona` 刷爆付费 LLM（成本/DoS） |
| 5 | **P1** | **全站无分页 / 无"最新"时间线** | 所有列表硬截断（首页 10 条封顶），**用户根本翻不到更早的新闻**；标语承诺"一手"却没有一个按时间浏览的快讯流 |

### 缺陷分布（约 70 项）

| 领域 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| A. 安全与账号 | 1 | 2 | 1 | 2 |
| B. 数据管线与内容 | – | 3 | 4 | 2 |
| C. AI 解读与合规 | – | 1 | 4 | 2 |
| D. 行情 | – | – | 1 | 2 |
| E. 功能与用户流程 | – | 6 | 5 | 5 |
| F. UI / 设计 / 可访问性 | – | 5 | 8 | 12 |
| G. 数据模型与性能 | – | – | 3 | 5 |

> **一句话结论**：先补安全与数据管线这两块"地基"（用户看不见但一塌全塌），再修转化/留存流程断点，最后收 UI 设计系统的一致性债。

---

## 二、严重度定义

- **P0 立即修**：安全漏洞 / 数据泄露 / 核心功能不可用。
- **P1 近期修**：显著削弱核心价值、明显影响多数用户、或有成本/合规风险。
- **P2 中期修**：影响体验或可维护性，非阻塞。
- **P3 打磨**：一致性、可访问性细节、锦上添花。

每条格式：**严重度 · 标题** — `证据 file:line` — 影响 — 建议。

---

## 三、缺陷清单

### A. 安全与账号 🔐（当前最薄弱环节）

- **[P0] OTP 可暴力破解 → 账号被盗** — `otp-verify.ts:16-19`（无失败计数）、`config.ts:34-43`、`auth.ts:39-41` 两个校验入口均无限流；码 6 位（`otp.ts:5`）、TTL 10 分钟（`otp.ts:14`）。攻击者输入受害者邮箱触发验证码后，10 分钟内脚本穷举即可登录。**修**：按 identifier+IP 限失败次数、N 次后作废+锁定/退避、验证路径加限流/验证码。
- **[P1] `requestOtp` 无限流 → 邮件轰炸 + 阿里云 DirectMail 成本失控** — `auth.ts:13-36` public、每次删+建 token 并发信、无冷却。**修**：按邮箱+IP 冷却（如 1/min、N/day）。
- **[P1] `analytics.track` public 且无界 → 写入型 DoS / 数据污染** — `analytics.ts:11-29`，`type` 自由字符串、id 不校验存在、无限流。**修**：限流 + 校验 id/枚举 type + 可要求会话。
- **[P2] `auth.verifyOtp` 是"死而危险"的第二攻击面** — `auth.ts:39-41` 登录实际走 `signIn("credentials")`（`login/page.tsx:36`），此 tRPC 端点无人调用却仍会消费 token，是额外的无限流爆破面，并可能与正常登录竞争删 token。**修**：删除或并入登录流并加同等限流。
- **[P3] `watchlist.followMany`/follow/bookmark 不校验 id → 单个坏 id 整批 FK 失败** — `watchlist.ts:57-68` 直接 `createMany`。**修**：先过滤存在的实体或优雅处理 FK 错误。
- **[P3] 无 OTP 尝试/锁定持久化模型** — A 区安全修复需要一张 attempts/lockout 表，目前不存在。

> ✅ **正面**：未发现 IDOR——所有 `protectedProcedure` 均按 `ctx.session.user.id` 归属过滤，未鉴权调用被正确拒绝（`trpc.ts:121-133`）。

### B. 数据管线与内容 📥（核心价值："一手 + 聚焦"）

- **[P1] 媒体源永远拿不到 `eventType` → importance 被硬顶在 30，永不达 55 阈值** — 仅 `cninfo.ts:97` 设了 `eventType`；`wallstreetcn/eastmoney/jiwei` 都不设。`importance.ts:31-37`（MEDIA 加成 10 + 基线 20 = 30）< `news.ts:35` / `notifications.ts:3` 的 `55` 门槛。**结果**：首页「重大动态」和整个通知系统**只会出现带关键词的巨潮公告**，三个媒体源的绝大多数内容永远沉底；只关注媒体覆盖实体的用户**永远收不到通知**。**修**：在 `runner.ts` 对所有源跑 `detectEventType(title/summary)`，重新标定阈值。
- **[P1] 任一源抛错中断整轮 ingest（无逐源隔离）** — `ingest.ts:18` 循环无 try/catch，媒体源 `!res.ok` 直接 `throw`。一次 wallstreetcn 超时会静默跳过其后的 eastmoney+jiwei。**修**：逐源 try/catch、记录失败、继续。
- **[P1] 新鲜度单点：ingest 是单台 Mac 上离线脚本、无健康记录、重启不自恢复** — 无 in-repo 调度、无 `IngestRun` 健康表；Mac 睡眠/重启即静默断流，前端无"最后更新"提示。对"一手快讯"产品这是核心价值静默失效。**修**：加 `IngestRun`（逐源 startedAt/finished/fetched/inserted/error）、前端陈旧横幅、迁到有守护+自启的服务 + 死信告警。
- **[P2] 去重 hash 含标题 → 编辑即重复入库；无跨源去重 → 同一快讯在东财+华尔街见闻各存一条** — `runner.ts:47` `newsHash(key, externalId??url, title)`。**修**：身份仅取 `(sourceKey, externalId)`；加内容相似度聚类做跨源近重。
- **[P2] `publishedAt` 非法未防护（cninfo & wallstreetcn）→ 一个 Invalid Date 拖垮整轮** — `cninfo.ts:96`、`wallstreetcn.ts:48` 无 `isNaN` 守卫（eastmoney/jiwei 已有）。**修**：套用同样的 `isNaN(d)?new Date():d`。
- **[P2] 实体标注是裸关键词子串、`relevance` 恒为 1 → 蹭词污染实体流** — `entity-tagging.ts:22-44`、`runner.ts:71` 从不设 relevance（默认 1，`schema.prisma:164`）；`"IC"` 别名会误命中"IC卡/IC设计"。**修**：算真实 relevance（标题>正文、词频、位置），低相关不进流。
- **[P2] 话题覆盖实质硬编码为半导体；未标注的媒体新闻抓了却无处可达** — `seed.ts:5-28` 仅种半导体+8 股+1 人；`cninfo.ts:72-78` 只抓种子 ticker。未命中 ~18 个实体的新闻存了但不展示。**修**：加"全站/最新"流 + 种子扩展计划。
- **[P3] eastmoney 原文链接用 `code` 字段拼接** — `eastmoney.ts:32`，需确认 `code` 是文章 id 而非股票代码，否则"查看原文"全 404 且去重身份错。
- **[P3] 无内容规范化/聚类 id** — 无法表达"同一故事的更新版/跨源同一故事"（见上 P2）。

### C. AI 解读与合规 🤖（产品差异化 + 监管红线）

- **[P1] `interpret.getOrCreate` 是无鉴权 public mutation → 任何人可刷爆付费 LLM** — `interpret.ts:15`，模型 `claude-sonnet-4.5`、`max_tokens:900`（`ai.ts:47`），仅首次成功后才缓存。可枚举 `newsId×5 kind` 制造上千次调用。**修**：改 `protectedProcedure` + 按 IP/用户限流、限窗口内未缓存生成数。
- **[P2] 并发同 (newsId,kind) 双计费并撞唯一约束报错** — `interpret.ts:25-28` 先 find 后 create，`@@unique([newsId,kind])`（`schema.prisma:200`）；第二个 create 抛 `P2002` → 用户见"生成失败"。**修**：改 `upsert` 或捕获 P2002 重读。
- **[P2] OpenRouter 调用无超时/AbortController → 上游卡住无限挂起** — `ai.ts:33-51` 无 `signal`。**修**：`AbortSignal.timeout(~25s)` + 有界重试。
- **[P2] 合规过滤是可绕过的正则兜底，且新闻内容原样注入 prompt（注入面）** — `ai.ts:27,144` 嵌 `【内容】${content}` 未转义；`compliance.ts:8-29` 只匹配"相邻"触发+动作、仅中文。"建议逢低买入"（被"逢低"隔开）**不会被拦**，英文/全角变体亦可绕过。对中国金融应用是监管风险。**修**：加强分类器（LLM 合规校验或更宽词法+距离匹配）、隔离注入内容、记录近失。
- **[P2] 巨潮公告只有标题（content 空、summary==title）→ AI 据一行标题脑补细节** — `cninfo.ts:90-96`、`interpret.ts:47-50`。最受信任的 PRIMARY 源反而最易被幻觉，而合规正则只查措辞不查事实。**修**：仅标题时跳过/弱化解读，或取官方摘要。
- **[P3] 被合规拦截的输出被永久缓存、换模型不失效** — `interpret.ts:51-67` 把拦截信息也 create 了，`model` 存了但从不用于失效。**修**：不缓存被拦结果（或存 `blocked` 标志允许重生成）、缓存键含模型/版本。
- **[P3] 无用户反馈/举报入口** — 面对合规敏感的 AI 解读，没有"这条解读有问题"的上报。**修**：解读面板加轻量反馈。

### D. 行情 📈

- **[P2] sina/tencent 无超时 + SSR 路径 `cache:"no-store"` → 上游慢拖垮实体页、规模化无缓存易被封 IP** — `quote.ts:16-38`、`entity/[id]/page.tsx:46` SSR 期 `await fetchQuote`。**修**：加 `AbortSignal.timeout`、按 symbol 缓存 10–30s、考虑批量。
- **[P3] 停牌/盘前(价 0)/收盘陈旧 与 抓取失败 无法区分、无 as-of 时间戳** — `quote.ts:34-36` 价≤0→null；`entity/[id]/page.tsx:62` null 默认红色；周末显示周五收盘却无"截至"标注，暗示实时。**修**：带上行情时间戳/市场状态，区分"停牌/休市"与"获取失败"。
- **[P3] 产品缺口（已知）**：无历史/分时图；仅有 ticker 的 STOCK 才有行情。

### E. 功能与用户流程 🔀

**(a) 新用户：落地 → 引导 → 登录 → 个性化**
- **[P1] Onboarding 是孤儿页——不在任何导航、登录后从不触发，且登出态渲染空白** — `onboarding/page.tsx:11` 登出会被踢走（真机走查：`/onboarding` 返回 200 但主区**全空**）；登录后落在 `/` 而非引导。仅 `/feed`、`/notifications`、`/profile` 的空态链到它。多数用户永远见不到个性化引导。**修**：首次登录且 watchlist 为空时重定向到 `/onboarding`；落地页加入口；修登出态空白（或做成脱离 shell 的专注流程）。
- **[P1] 登录无 returnTo/callbackUrl → 登录后一律回 `/`、丢失意图** — `login/page.tsx:39`、`_follow-button.tsx:35`。点"登录后关注"→登录→被丢到首页，想关注的没关成。**修**：传 `?returnTo=` / NextAuth `callbackUrl` 并跳回。
- **[P2] 登出态价值主张弱、移动端沉在折叠下、无 hero/注册 CTA** — `page.tsx:102-110`「关于解牛」在右栏、移动端堆在整个列表之下；首访唯一转化点是顶栏小"登录"。**修**：登出态加首屏价值 hero + 主 CTA。
- **[P2] 首页从不个性化（即便已登录）** — `page.tsx:30-34` 永远渲染全站 `news.important`；个性化只在 `/feed`。"个性化 feed"承诺只兑现一半、还分裂在两个 tab。**修**：登录且有关注时首页融合/优先关注实体，或明确"全站 vs 关注"。
- **[P2] OTP 步骤无重发/冷却/有效期倒计时** — `login/page.tsx:71-96` 只能"换个邮箱"。**修**：加"重新发送(60s)"+ TTL 提示。

**(b) 阅读：首页 → 详情 → AI 解读 → 原文/收藏**
- **[P1] 登出读者在详情页无收藏/登录 CTA → 最高意向时刻没有转化钩子** — `news/[id]/page.tsx:80-84` 收藏按钮仅对已登录渲染。**修**：登出时显示"登录以收藏"。
- **[P2] "← 返回"硬编码到 `/`、非真实返回** — `news/[id]/page.tsx:37-42`。从 feed/entity/notifications 进来点返回被丢到首页。**修**：`router.back()`（`/` 兜底）。
- **[P2] 详情页无"相关资讯"交叉链接 → 每篇文章是阅读死胡同** — `news/[id]/page.tsx:106-115` 侧栏只有 AI 解读。**修**：按共享实体推相关新闻。
- **[P3] `eventType` 查了却不展示** — `news.ts:21` select 了但详情页不渲染（业绩/重组/监管 等有用分类被丢）。**修**：做成 chip。
- **[P3] content 与 summary 都空时正文空白无兜底** — `news/[id]/page.tsx:86-92`。**修**：给"仅标题，点原文查看"。

**(c) 实体：搜索/浏览 → 实体页 → 关注**
- **[P1] 关注/取关不刷新侧栏关注列表与 feed → 关注"看起来没反应"** — `_follow-button.tsx:21-29` 只翻转本地 state + 埋点，从不 `utils.watchlist.list.invalidate()`；桌面侧栏「我的关注」与 `/feed` 需硬刷新才更新。**修**：onSuccess 失效 watchlist/feed/notification 查询（近乎一行）。
- **[P2] 移动端 entity/news 页无搜索入口、⌘K 触屏够不到** — `command-palette.tsx` 只被桌面侧栏按钮打开；`EntitySearch` 只在 `/`、`/discover`。**修**：移动端头/tab 加搜索图标打开面板。
- **[P2] 搜索无历史/最近/建议、关闭即清空** — `command-palette.tsx:74-81`。**修**：持久化最近搜索/展示热门实体。
- **[P3] 真实 ticker 抓取失败时行情卡静默消失，与"无 ticker"不可区分** — `entity/[id]/page.tsx:46`、`quote.ts:43`。**修**：有 ticker 但 null 时显示"行情暂不可用"。

**(d) 留存：feed / notifications / profile**
- **[P1] 移动端 TabBar 无「通知」；登出移动用户根本到不了通知** — `tab-bar.tsx:8-13`（仅 首页/发现/关注/我的）vs 桌面 `sidebar.tsx:27`。登录移动用户只能靠头部铃铛，登出移动用户只能手敲 URL。移动/桌面能力面不一致。**修**：移动导航加通知（或登出头部加铃铛）。
- **[P2] Profile 关注列表无内联取关/管理** — `profile/page.tsx:66-80` 只链出。**修**：加内联取关（`orderWatchEntities` 已有，可加排序）。
- **[P2] 无账号管理** — `profile/page.tsx:110-115` 只有登出；无改邮箱/注销/会话管理。**修**：加账号/设置页。
- **[P2] 通知列表无已读/未读区分** — `notifications/page.tsx:39-63` 每次访问即 `markSeen()`、30 条同样式。**修**：标记晚于 `notificationsSeenAt` 的为新。
- **[P3] 通知排序与 feed/home 不一致** — `notifications.ts:19` 按 `createdAt`，而 `feed.ts:15`/`news.ts:36` 按 `importance`。**修**：统一排序策略。

**缺失的产品能力（table-stakes）**
- **[P1] 全站无分页/无限滚动/加载更多** — `news.ts:37`(10)、`feed.ts:16`(50)、`entity.ts:50`(30)、`notifications.ts:20`(30)、`bookmarks.ts:47`(全部)。用户物理上翻不到更早新闻——**新闻产品最大的缺口**。**修**：游标分页 + 无限滚动。
- **[P1] 无全站按时间的"一手/最新"流** — 唯一全站面是 `news.important`（≥55、前 10），媒体又进不去（见 B-P1）；标语"一手"没有对应的时间线浏览。**修**：加"一手/最新"chronological tab。
- **[P2] 无下拉刷新/手动刷新** — 页面 `force-dynamic` 但页内无刷新，移动端无法下拉取新。**修**：加刷新控件/定期 revalidate。
- **[P2] 有浏览埋点却无已读标记** — `analytics.ts:32` 记 `view_news`（供"最近浏览"）却不用来置灰已读卡。**修**：标记已读。
- **[P2] 无价格/公告提醒（alerts）** — schema 无 alert 模型；A 股应用应有。**修**：加提醒模型 + 投递。
- **[P2] 无分享** — 详情/卡片无复制链接/微信/社交分享（仅"查看原文"）。
- **[P2] 无设置/通知偏好** — 有邮件基建（OTP）却无设置页、无邮件摘要订阅；通知仅站内拉取。
- **[P3] Discover 无全空兜底** — `discover/page.tsx:37-57` 空类型渲染 null。

### F. UI / 设计系统 / 可访问性 🎨

**非令牌色 / 暗色破坏（最高杠杆，出现最广）**
- **[P1] 来源徽标用裸 green/gray/yellow、暗色不翻转** — `format.ts:27,29,30` `bg-green-100 text-green-700`(一手)/`bg-gray-100`(媒体)/`bg-yellow-100`(衍生)。**每张 NewsCard**都渲染，暗色下亮色药丸浮在深色卡上、跳脱且与令牌体系无关；且 raw green 与 A 股 `down`(绿=跌)语义冲突。**修**：改令牌化，如 `bg-down/10 text-down`(一手)、`bg-muted/15 text-muted`(媒体)、`bg-brand/15`(衍生)。
- **[P1] `text-gray-400` 全站 15 处、浅色下不达 WCAG AA、且非令牌** — `#9ca3af` 在近白底约 2.5:1（正文/大字均不达标），且不随主题翻。位置：`page.tsx:92`、`discover/page.tsx:47`、`entity-search.tsx:24/29/42/47`、`news/[id]/page.tsx:74`、`command-palette.tsx:123/145/150/159`、`sidebar.tsx:69/133/161`、`notification-bell.tsx:16`、`theme-toggle.tsx:30`、`login/page.tsx:10`。**修**：统一换 `text-muted`（达标且翻转），删 `dark:text-gray-400` 覆盖。
- **[P1] 登出按钮无暗色变体、暗色下边框/文字不可见** — `logout-button.tsx:10` `border-gray-200 text-gray-600` 无 `.dark`。**修**：`border-line text-muted`。
- **[P1] 无 `error.tsx` / `not-found.tsx`（全站）** — 每路由 `force-dynamic` 且实时取数；任何抛错落到 Next 未样式化默认页；`notFound()` 在 `entity/[id]:44`、`news/[id]:24` 调用却无自定义 404（真机确认：显示英文默认 404）。**修**：加品牌化 `error.tsx` + `not-found.tsx`（+ `global-error.tsx`）。
- **[P1] 桌面布局不一致：发现/关注/我的/通知/登录仍是窄左列 + 右侧大片留白** — 只有 首页/详情/实体 做了 `lg` 加宽双栏（真机确认）。这几页在桌面显得未完成、左重右空。**修**：统一容器宽度与布局节奏（或给这些页也做合适的桌面版式）。

**响应式**
- **[P2] md→lg "尴尬带"：md 就出侧栏，但正文仍窄单列到 lg** — 768–1023px 时 256px 侧栏 + 672px 封顶正文 + 右侧大空洞，右栏卡塌到折叠下。宽度跳变 672→1024 与 单→双栏 都卡在 `lg` 同时发生。**修**：`md:max-w-4xl` 提前放宽或把双栏提前到 `md`。
- **[P2] 移动端头部图标按钮低于 44px 触达最小值** — ThemeToggle 无 padding、图标 `h-5 w-5`≈20px（`theme-toggle.tsx:30`）；Bell `h-6 w-6`≈24px。**修**：加 `p-2 -m-2`。
- ✅ 超宽已封顶不过度拉伸；chips/行情网格均 `flex-wrap`、无横向溢出。

**空/加载/错误态**
- **[P2] `loading.tsx` 覆盖不全** — 仅 `/`、`/feed`、`/entity/[id]` 有；`/discover`、`/notifications`、`/profile`、`/news/[id]` 缺（async 页取数时白屏）。**修**：复用 `NewsListSkeleton` 补齐。
- ✅ feed/notifications/profile/home/entity 有不错的内联空态；解读面板有骨架+加载+错误态。

**可访问性**
- **[P1] focus-visible 几乎全缺** — 全站仅 `sidebar.tsx:65` 一个键盘焦点环，其余按钮/链接（tab bar、persona chips、收藏、关注、引导 chips、命令面板结果行、账号下拉、新闻卡）都用 UA 默认框、在 `rounded-full` 上难看且不一致。**修**：抽共享 `focus-visible:ring-2 ring-brand/40 ring-offset-2`。
- **[P2] 命令面板输入框 `outline-none` 却无替代焦点样式** — `command-palette.tsx:123`。**修**：加 `focus:ring-2`。
- **[P2] 命令面板不是可访问 dialog** — `command-palette.tsx:108-116` 无 `role="dialog"`/`aria-modal`/焦点陷阱，Tab 会逃到背景。**修**：加 ARIA + 焦点陷阱 + 关闭后归还焦点。
- **[P2] 账号下拉缺 ARIA + 键盘语义** — `sidebar.tsx:150-191` 无 `aria-expanded`/`haspopup`/`role="menu"`、无 Esc 关闭。
- **[P3] 无"跳到内容"链接**；键盘用户每页要 tab 过整个侧栏。
- ✅ 每页单 `h1`、层级干净；图标均 `aria-hidden`、logo 有 `aria-label`；`lang="zh-CN"`；`text-muted` 令牌本身达标。

**视觉一致性**
- **[P2] "实体类型"有 3 种渲染** — 卡片 source tier 彩色药丸(`format.ts:25`)、实体页灰盒(`entity/[id]:162`)、裸 `text-gray-400` 文字(`entity-search:47`/`command-palette:150`/`news/[id]:74`/`sidebar:133`)。**修**：统一 `<TypeBadge>`。
- **[P2] "主按钮"有 2 套色 + 内联重复 3 处** — 近黑 `primaryBtn`（`section-head.ts:30`，被 `layout.tsx:70`/`sidebar.tsx:196` 复制粘贴）与琥珀 `bg-brand`（`login:12`/`onboarding-picker:73`/`_follow-button:54`）并存无规则。**修**：抽 `brandBtn` 并文档化用法。
- **[P3] `chipClass` 在同文件里被绕过**（`entity/[id]:106`、`news/[id]:71` 各自内联近似）；**圆角 5 档无标度**（`rounded`~`rounded-2xl`）；**卡片阴影不一**（NewsCard 有 `shadow-sm` 而 RailCard 无）；**图标尺寸漂移**（20/22/24 混用）。**修**：标度化 + 统一。

**打磨 / 微交互**
- **[P2] 死代码 `post.tsx`（create-t3-app 脚手架残留，英文、`text-white` 于亮底不可见）** — `post.tsx:38,42`，无处引用。**修**：删除。
- **[P3] 根骨架与桌面双栏不匹配**（`loading.tsx:5` 单列 `max-w-2xl` vs 真实 `lg:max-w-5xl` 双栏）；**关注/收藏非乐观更新**（`_follow-button:22-29`/`bookmark-button:15-17` 仅 onSuccess 翻转，点按有往返延迟）；**主题切换/命令面板无过渡动画**。
- **[P3] 通知计数徽标 `bg-red-500` 非令牌**（`notification-bell:21`/`sidebar:92`；注意本应用 红=涨）。

### G. 数据模型与性能 🗄️

- **[P2] `NewsItem.importance` 无索引（更无 `(importance, publishedAt)` 复合索引）** — `schema.prisma:158` 仅 `@@index([publishedAt])`，而 feed/important/notifications 都按 importance 排序+过滤。**修**：`@@index([importance, publishedAt])`。
- **[P2] `AnalyticsEvent` 索引是 `(type, createdAt)`，但 `recentViews` 按 `userId` 过滤** — `schema.prisma:223` vs `analytics.ts:32-42` → 全表扫。**修**：`@@index([userId, type, createdAt])`。
- **[P2] 无 ingest 可观测表** — 见 B-P1，加 `IngestRun`。
- **[P3] `Entity.ticker`/`(type,ticker)` 无唯一约束** — 允许重复股票实体，行情/去重查询歧义。
- **[P3] `AnalyticsEvent.meta` 从不写入**（死列）；**`Interpretation` 无 `blocked`/版本标志**；**NewsItem 无聚类/canonical id**。

---

## 四、优先级路线图

### 🚑 Sprint 0 — 安全与成本止血（本周，多为小改）
1. **[P0]** OTP 失败次数限制 + 锁定/退避 + 失败作废（新增 attempts 持久化）
2. **[P1]** `requestOtp` 按邮箱+IP 冷却限流
3. **[P1]** `interpret.getOrCreate` 改 `protectedProcedure` + 限流
4. **[P2]** `analytics.track` 限流 + 校验 + 枚举 type；删除死端点 `auth.verifyOtp`

### 🩹 Sprint 1 — 修复核心价值（数据管线，用户看不见但一塌全塌）
1. **[P1]** 所有源跑 `detectEventType`，让媒体能进「重大动态」/通知，重标阈值
2. **[P1]** ingest 逐源 try/catch 隔离 + `publishedAt` isNaN 守卫
3. **[P1]** `IngestRun` 健康表 + 前端"最后更新/陈旧"横幅 + 死信告警；调度上守护/自启
4. **[P1]** 加"一手/最新"按时间全站流 + **列表游标分页/无限滚动**
5. **[P2]** 去重身份改 `(source, externalId)`；实体标注算 relevance

### 🔧 Sprint 2 — 转化与留存流程断点
1. **[P1]** 登录 returnTo 跳回；首次登录且无关注→引导流（并修 onboarding 空白）
2. **[P1]** 关注/取关 `invalidate` 侧栏+feed+通知（≈1 行，立竿见影）
3. **[P1]** 移动端加「通知」入口；详情页登出态加"登录以收藏"CTA
4. **[P2]** 详情"相关资讯"交叉链；已读/未读标记；下拉刷新；账号/设置页

### 🎨 Sprint 3 — UI / 设计系统一致性（还技术债）
1. **[P1]** `tierBadgeClass` 令牌化；`text-gray-400`→`text-muted` 全站扫；登出按钮暗色
2. **[P1]** 加 `error.tsx`/`not-found.tsx` + 补 4 个 `loading.tsx`
3. **[P1]** 统一 发现/关注/我的/通知/登录 的桌面版式
4. **[P1/P2]** 共享 `focus-visible` 环 + 命令面板做成可访问 dialog；删死代码 `post.tsx`
5. **[P2]** 抽 `<TypeBadge>`/`brandBtn`；圆角/阴影/图标标度化

### 🧱 长期 / Backlog（P2–P3）
索引优化（importance / analytics）· 行情缓存+超时 · 解读 `upsert` 防竞争 + 超时 · 合规分类器加强 + 注入隔离 · 价格/公告提醒 · 分享 · 邮件摘要 · 乐观更新 · 历史/分时图 · 话题覆盖扩展。

### ⚡ Quick Wins（低成本高收益，可穿插任意 sprint）
`text-gray-400`→`text-muted` 全局替换 · 删 `post.tsx` · 加 `not-found.tsx`/`error.tsx` · 关注 `invalidate`（1 行）· 登录 returnTo · `@@index([importance, publishedAt])` · `publishedAt` isNaN 守卫 · 逐源 try/catch。

---

## 五、做得好的地方（不要在重构里弄丢）

- **鉴权模型干净**：`protectedProcedure` 一律按 user.id 归属，无 IDOR。
- **设计令牌体系**（brand/ink/canvas/surface/line/muted/up/down）明暗自适应，基础牢固——问题只是有些地方没用它。
- **合规意识在线**：AI 解读走 `isCompliant`+`withDisclaimer`+标注，行情"仅供参考不预测"——方向对，只是过滤器强度要补。
- **响应式外壳 + 命令面板 + 三栏桌面**已具备"完整应用"的骨架；键盘 ↑↓/Enter/Esc 列表导航已做。
- **纯函数 + 单测**（82 个）覆盖 relativeTime / summaryIsRedundant / orderWatchEntities / moveHighlight 等；标题层级/aria-label/lang 等 a11y 基本功到位。

---

## 六、战略层面的一句话建议

解牛已经"像个完整应用"，下一步不是加更多页面，而是**让核心承诺真正成立**：(1) 让"一手快讯"稳定、新鲜、可翻阅（数据管线 + 分页 + 最新流）；(2) 让"个性化"闭环（关注即时生效 + 引导漏斗 + 首页融合）；(3) 把安全与合规这两条底线夯实（OTP/限流 + 合规分类器）。把这三件事做扎实，比任何新功能都更能决定这个产品能不能留住人。
