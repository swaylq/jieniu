# 提醒投递层（Alert Outbox）—— 被动变主动

> 起因：TMs 反馈「感觉可以把推送想办法加上，哪怕只是推到网页端的 inbox」「被动变主动提醒这是重要的一部分」「让 ai 在推送前拦一刀」「现在的券商 app 基本都是全量推很烦」。
> sway 定调：投递层先做在解牛里，但**接口按通用投递设计**（kind 不写死财经语义、payload 渠道无关），跑通后可整体搬到 hermit。站内必须有「最新推送」的显示。

## 为什么先做表，不先接渠道

解牛现有提醒是**派生查询**——`PriceAlert` 的 schema 注释写着「沿用『派生通知』架构：无独立 Notification 表」。
`notifications.thesisAlerts` 是一条近 30 天的即时查询：维度**跨越发生的那一刻，系统里没有任何东西被创建**。

推送需要一个「这件事刚发生 / 还没告诉过你 / 已经从哪个渠道告诉过你」的实体。没有它，接任何渠道都会重复推、
漏推、跨渠道打架（网页看过了邮件还在发）。所以第一步是**事件化**，不是接渠道。

## 数据模型

`AlertEvent`（Outbox）：`(userId, dedupeKey)` 唯一 → 同一事实只投一次，跨渠道共享。

- `kind`：`logic` | `fundamental` | `price`（通用语义预留 `digest` 等）
- `occurredAt`：**事实发生时刻**（跨越时刻 / 触发时刻 / 发布时刻），排序按它，不按 `createdAt`——
  回填资讯的 `createdAt` 是「现在」，用它排序会让历史整批变成新动态（沿用 `notifyWindowStart` 的教训）。
- `readAt` / `emailedAt` / `pushedAt`：分渠道投递水位。站内已读与站外投递解耦。
- `priority`：投递优先级（重点维度逻辑异动 > 逻辑异动 > 到价 > 重磅资讯）。

`User` 加两个字段：`alertEmail Boolean @default(false)`（**默认关**，存量用户不会突然收信）、
`alertEmailToken String? @unique`（免登录退订链接用）。

## 分层：站内全收，站外限量

- **站内 inbox** = `AlertEvent` 全量倒序。它就是提醒中心，不该限流。
- **站外投递**（邮件 / 以后的 Web Push / webhook）从**未投递**事件里按优先级取前 `DELIVERY_MAX_ITEMS` 条，
  其余在信里写明「另有 N 条在站内」——不静默截断。

这就是「推送前拦一刀」的落点，六道闸：

0. **推送门槛高于浏览门槛**（`isPushWorthyNews`）——见下节，这道闸是实测出来的
1. 分类开关（`alertPrefs` 四类，已有）
2. 维度静音（`UserThesis` 的 muted，已有）
3. **复核负反馈**：某维度最近一次复核动作是 `dismissed` → 该维度后续跨越**只进站内、不投站外**。
   `ThesisAlertReview` 的数据一直只用来排序，这里第一次回灌到投递决策。
4. **条数上限**：一次投递最多 `DELIVERY_MAX_ITEMS` 条
5. **免打扰时段**：`QUIET_START` 22:00 – `QUIET_END` 07:30 不投站外

外加一条同公司折叠：一轮里同一家公司只推一条（沿用早报 `collapseDigestItems` 的 `perCompany=1` 思路）——
跨源重复（同一次回购既有公告又有快讯）和程序性文档轰炸都从这里收口。

## 实测发现：站内浏览门槛不能直接拿来当推送门槛

首轮按「沿用 `notifications.list` 的 `importance≥55`」生成，10 条候选里 5 条是噪音、2 条是同一事实的跨源重复：

| 绑定数 | 重要性 | 层级 | 标题 | |
|---|---|---|---|---|
| 7 | 75 | MEDIA | 华尔街见闻早餐 \| 2026年7月27日 | ✗ 综述 |
| 5 | 70 | MEDIA | 月内超600家A股上市公司获机构调研 | ✗ 综述 |
| 3 | 55 | MEDIA | 二季度券商股获集中增持 | ✗ 综述 |
| 1 | 55 | MEDIA | 证券时报头条评论：注销股票式回购值得提倡 | ✗ 评论 |
| 2 | 70 | PRIMARY | 东山精密:关于首次回购公司股份的公告 | ✓ |
| 2 | 80 | PRIMARY | 中信证券:…华夏基金半年度业绩快报的公告 | ✓ |

噪音长得高度一致：**媒体稿 + 顺带绑 3~7 家公司**。真·个股事实全是**一手公告 + 绑 2**
（同一家公司的 COMPANY 与 STOCK 两个实体）。于是：

```
boundCount ≤ 2  且  非综述(isRoundupNews)  且  (tier=PRIMARY 或 importance ≥ 70)
```

实测 10 → 2 条。既有的 `isRoundupNews` 一条都没拦住（它的 `boundCount≥8` 阈值是为「绑定剥离」设的，
对推送太松）——**绑定扇出**才是这里最锋利的判据。

一般原则：**pull 宽、push 严**。站内随便翻可以宽，能主动打断人的必须更窄。

## 文件

新增（不碰其他 session 正在改的 `daily-digest.tsx` / `news.ts` / `digest.ts`）：

- `src/lib/alert-outbox.ts` + `.test.ts` —— 纯逻辑：草稿生成、dedupeKey、优先级、五道闸、投递选取
- `src/lib/alert-email.ts` + `.test.ts` —— 纯逻辑：邮件主题 / HTML 渲染
- `src/server/alert-outbox.ts` —— DB 生成器（取数 → 纯逻辑 → `createMany skipDuplicates`）
- `src/server/api/routers/inbox.ts` —— 站内 inbox 的 list / unreadCount / markRead / 邮件开关
- `src/app/_components/push-inbox.tsx` —— 「最新推送」区
- `src/app/unsubscribe/page.tsx` —— 免登录退订
- `src/scripts/alert-dispatch.ts` —— cron 入口（`--generate` / `--email` / `--dry`）

共享文件只做一行级改动：`schema.prisma`（追加 model + User 两字段）、`root.ts`（注册 router）、
`email.ts`（追加一个通用 `sendMail`，不改既有函数）、`notifications/page.tsx`（插入「最新推送」区）。

## 不做

- 微信通道：公众号模板消息对金融类有资质与内容限制、企业微信机器人只能推群、个人号协议有风控风险。
  产品侧只吐标准 payload，用户自接 webhook（下一步）。
- Web Push：`manifest.webmanifest` 已有但无 service worker、无 `web-push` 依赖。iOS 需先「添加到主屏」，
  漏斗多一道坎，排在邮件之后。

## 验收结果（2026-07-28）

已通过：

- `vitest run` **797 通过**（本次新增 40 测）；`next lint` **0 error**；`tsc --noEmit` 本次改动的文件零错误
  （全项目仍有 34 条既有错误，都在 `digest-filter/earnings-calendar/event-timeline/opportunity/search`
  的 **test 文件**里、且这些文件在 HEAD 上就是这样——非本次引入，也不阻断 `next build`：
  另一 session 14:04 用同样的树构建并重启成功过）
- 真实库生成：3 用户 / 草稿 2 / 新建 2 / 去重挡下 0；**复跑 → 新建 0、去重挡下 2**（幂等成立）
- 逻辑异动通路定向验证：48h 窗口内 0 次跨越（正确的空，与故障同形），故放宽到 25 天覆盖唯一那次历史
  跨越——生成「澜起科技『现金流与资本开支』转向偏兑现」，hedged 理由 / 触发依据 / payload / 落地页全对，
  验完清回 48h 基线
- 邮件 dry-run：选中 1 条、主题与退订链接正确、`emailedAt` 未写入；跑完把 `alertEmail`/`alertEmailToken`
  两列整体归位（这两列当天才建，正确状态就是全 false/null）

已上线（sway 授权后一次做完）：

- `npm run build` **exit 0**（单独跑、确认后才重启），`scripts/start-prod.sh` 重启：
  首页 200 / CSS 哈希 200 / `[boot] ✓ 密钥齐全：AI + 邮件可用`
- **真实发信一封**到 `swaylq0913@gmail.com`（阿里云受理，`emailedAt` 已写入；同批另一用户没开邮件、
  正确未受影响）。sway 的账号已开启邮件投递，可在提醒中心自行关闭
- 公网链路复验：`/` 200（371ms）、`/notifications` 200、**`/unsubscribe` 200（新路由）**、CSS 哈希 200
- 跨断点截图：PC 1440 + 移动 390 均正常；退订页未登录可访问、认出邮箱、确认式按钮
- cron 两条（`/cron` 页可改）：
  - 「解牛 提醒事件生成(Outbox)」每 60m ±8m 跑 `--generate`
  - 「解牛 每日提醒邮件(A股盘后)」每 1440m ±10m 跑 `--generate --email`，起点落在 ~15:2x（A 股收盘后）

同批上线的还有另一 session 的在飞改动（`rotation` router 等）——sway 明确授权全部部署。

## 下一步 backlog

- Web Push：`manifest.webmanifest` 已有，缺 service worker + `web-push` 依赖 + `PushSubscription` 表；
  iOS 需先「添加到主屏」才允许推送（16.4+），漏斗多一道坎
- webhook 出口：只吐标准 payload，用户自接企业微信 / 飞书 / Telegram / bark——绕开公众号金融类资质问题
- `dismissed` 累计降级：现在只看**最近一次**复核动作，应改成连续 N 次才降级
- 早间那封邮件：`cron_create` 只接受间隔不接受起始时刻，要加得在 `/cron` 页手工排
