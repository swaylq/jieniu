# 解牛 (Jiéniú) — MVP 设计文档

- **日期**：2026-07-01
- **状态**：待 sway review
- **命名寓意**：取「庖丁解牛」——把复杂的财经信息拆解到游刃有余、看得透。刻意淡化「牛市」联想，与下文「中性解读」的合规定位保持一致。

---

## 1. 一句话定位

给个人的、**聚焦式的一手财经资讯** + **用投资大师的框架来解读**。三个关键词：一手、聚焦、解读——与满屏洗稿自媒体反向而行。

面向大众的产品（需账号 + 个性化），A 股为主，免费/公开数据源起步。

## 2. MVP 范围（方案 A：半导体单板块，跑通全链路）

第一刀只切**半导体一个板块**，但要端到端能用，目的是最快验证两个核心不确定性：
1. 免费一手数据源的质量够不够；
2. AI 解读 / 大师视角到底有没有价值。

### 做什么

- 半导体板块的实体图谱（板块 / 成分公司 / 股票 / 头部公司关键人物）
- 1–2 个数据源跑通抓取管线，新闻带「来源等级」标签
- 简单账号 + 关注实体 + 个性化 feed（时间 × 重要性排序）
- 中性解读（结构化） + 巴菲特一个 persona（按需生成）
- 合规红线从第一天就设计进去

### 明确不做（YAGNI）

实时行情 / K 线、社区评论、组合记账、多板块、多 persona（巴菲特之外后补）、手机号短信 & 微信登录（见待确认项）。

## 3. 核心模型：实体图谱（产品的心脏）

一切皆「可关注的实体」，同一套模型满足全部关注场景：

- **板块 / 主题**（半导体…）
- **公司**（上市主体）
- **股票**（交易标的，一公司可 A/H 多地上市）
- **人物**（高管、大佬——"老板参加了什么会议"挂在人物实体上）

实体间连边：`公司 ∈ 板块`、`公司 → 股票`、`人物 → 公司(任职)`、`公司 ↔ 公司(产业链/竞对)`。

每条新闻抓入即打上关联实体标签。用户 feed = 关注实体的新闻并集，再排序。关注半导体 → 看到整个板块；关注英伟达 → 看到它的一切。同一套逻辑。

## 4. 数据来源与「一手」分级

MVP 起步 6 源（均已 2026-07-01 实测可抓，具体端点/请求头/坑见 `docs/reference/data-sources.md`）：

| 源 | 等级 | 价值 | 抓取方式 |
|---|---|---|---|
| **巨潮资讯网 cninfo** | 一手 | 全 A 股公告基石，科创板可单拉，PDF 免费直取 | 直连 JSON API |
| **东方财富快讯** | 媒体 | 实时 7×24 快讯，最易接 | 开放 JSON |
| **深交所互动易** | 准一手 | 投资者问答（差异化核心），一次返完整问答对 | 直连 JSON API |
| **集微网** | 媒体(原创) | 半导体原创一手行业报道 | 全文 RSS |
| **华尔街见闻 live** | 媒体 | 每条带 `symbols[]`，可按芯片股精准挂载 | 开放 JSON |
| **TrendForce 集邦** | 准一手 | DRAM/NAND 价格等原始数据（别人洗稿的源头） | HTML/自托管 RSSHub |

扩展源（后续接）：芯东西/芯智讯 wp-json、上证 e 互动、上交所/深交所/北交所公告、证监会、财联社电报、董监高变动。

每条新闻打 **来源等级标签**（诚信卖点，别家不愿做）：

- `PRIMARY 一手` —— 官方披露 / 公司 IR
- `MEDIA 媒体` —— 媒体报道
- `DERIVED 衍生` —— 解读 / 二手加工

**版权与合规红线**：媒体来源只存**摘要 + 回源链接**，不转载全文；官方公开披露可存更多。尊重来源条款 / robots。

## 5. 数据管线

`抓取 → 归一化 → 去重(hash) → 实体标注 → 重要性打分 → 入库 → 扇出到用户 feed`

- **抓取**：每个源一个 fetcher，走 hermit `cron` skill 定时触发（严禁手搓 launchd / crontab），写入同一 PostgreSQL。多数源**直连 JSON API**（不走公共 `rsshub.app`，已被 CF 墙）；PDF 附件**统一从 cninfo 取**；抓取节点放**大陆出口或加代理**（多 CN 主机对非大陆 IP 慢/半通）。每个 fetcher 上线前按参考文档自测。
- **实体标注**：先字典匹配（股票代码 + 公司名/简称/别名，便宜且精确），再对板块/主题/人物用 LLM 兜底和消歧。
- **重要性打分**：规则基线（事件类型权重：财报/业绩预告/停复牌/重大合同/监管处罚 = 高；`PRIMARY` 来源加权）+ 轻量 LLM 分。0–100。
- **解读生成时机（控 token 成本）**：
  - 中性解读：重要性 ≥ 阈值（如 60）**预生成**，其余**按需**生成，结果缓存。
  - 巴菲特视角：**纯按需**（用户点「看巴菲特怎么说」），首次生成后缓存。

## 6. AI 解读与大师 persona（差异化核心）

同一条新闻，两层：

### 6.1 中性解读（结构化输出，便于 UI 渲染 + 约束中立）

```
{
  概述: 一句话,
  为什么重要: string,
  影响的实体: [{ entityId, 方向: 利好|利空|中性 }],
  倾向: { 判断: 利好|利空|中性, 置信度: 0-1, 理由: string },
  风险与不确定性: string,
  免责声明: string (版本化)
}
```

### 6.2 巴菲特 persona（大师视角）

用蒸馏出的框架重读同一条新闻。**质量靠喂真实素材**（股东信、公开访谈），不是瞎编人设。

- 关注点：护城河、内在价值、能力圈、安全边际、长期主义、市场先生、忽略宏观噪音。
- 输出（同样结构化）：`{ 他会关注什么, 他会怎么框定这件事, 类比他过去说过/做过的, 一句话总结, 免责声明 }`，显式标注「这是思维方式演示，非投资建议」。
- **persona 模块存在代码里**（`personas/buffett.ts`，含原则 / 关注点 / 语气 / few-shot），版本化，MVP 不入库。

### 6.3 模型路由

- 中性解读走量：**Sonnet**（`claude-sonnet-5`）
- 巴菲特 / 复杂判断：**Opus**（`claude-opus-4-8`）
- 具体 model id 与参数以 `claude-api` skill 为准；可配置。

## 7. 合规红线（选「面向大众」后的硬约束）

国内面向大众做证券投资咨询需**牌照**，无牌「荐股」违规。因此从设计上定死：

- AI 解读定位为**信息解读 / 投教**，**不出**具体买卖指令、目标价、点位预测、收益承诺。
- 全站免责声明；persona 输出附「思维方式演示，非投资建议」。
- **双重约束**：prompt 层约束 + 输出后敏感表述过滤（正则 / 敏感词）。
- 来源分级让用户分清一手 / 媒体 / 解读。
- 记录 `disclaimerVersion` 便于审计。

## 8. 用户系统与个性化

- 账号：MVP **email OTP** 登录（`aliyun-email` skill / 阿里云 DirectMail），输入验证码直接进入；手机号短信 / 微信登录为后续产品化阶段。
- 关注列表（watchlist）：用户关注的实体集合。
- 个性化 feed：关注并集 + 排序（时间 × 重要性 × 相关度）。
- 推送（MVP 后期）：关注实体有重大一手事件 → 通知。

## 9. 前端 (PWA)

- **Feed 流**（我的关注）
- **实体页**（板块 / 公司 / 股票 / 人物）：新闻时间线 + AI 解读入口 + 关系
- **解读详情页**：中性解读 / 巴菲特视角切换
- **搜索 / 发现**：找实体、热门事件
- **个人中心**：关注管理、推送设置
- **免责声明 / 合规页**
- 可装手机主屏（走 `installable-pwa` skill）

## 10. 技术栈与部署

- `create-t3-app`：Next.js (App Router) + TypeScript + Tailwind + tRPC + Prisma + PostgreSQL + NextAuth
- AI：`@anthropic-ai/sdk`，Claude API
- 抓取：Node 脚本，`cron` skill 定时触发，写同一 PG
- 部署：本地 / VPS，用 `expose-tunnel` skill 出到 `jieniu.swaylab.ai` 验证
- 凭据：全部走 `secret` CLI，绝不明文（Anthropic key / 阿里云 / DB）

## 11. 数据模型（Prisma 草案）

```prisma
model Entity {
  id        String   @id @default(cuid())
  type      EntityType            // SECTOR | COMPANY | STOCK | PERSON
  name      String
  shortName String?
  aliases   String[]              // 别名/简称，用于字典匹配
  ticker    String?               // STOCK: 代码
  exchange  String?               // STOCK: SH | SZ | BJ | HK
  meta      Json?                 // 类型特有字段
  createdAt DateTime @default(now())
  relFrom   EntityRelation[] @relation("from")
  relTo     EntityRelation[] @relation("to")
  news      NewsEntity[]
  subs      Subscription[]
}

model EntityRelation {
  id     String @id @default(cuid())
  fromId String
  toId   String
  type   RelationType           // BELONGS_TO | ISSUES | WORKS_AT | RELATED
  from   Entity @relation("from", fields: [fromId], references: [id])
  to     Entity @relation("to",   fields: [toId],   references: [id])
}

model Source {
  id      String  @id @default(cuid())
  name    String
  tier    SourceTier            // PRIMARY | MEDIA | DERIVED
  kind    String                // rss | cninfo | ...
  config  Json
  enabled Boolean @default(true)
  news    NewsItem[]
}

model NewsItem {
  id          String   @id @default(cuid())
  sourceId    String
  source      Source   @relation(fields: [sourceId], references: [id])
  tier        SourceTier
  title       String
  url         String
  publishedAt DateTime
  summary     String                // 摘要（媒体源只存这个）
  content     String?               // 官方披露可存更多
  hash        String   @unique      // 去重
  importance  Int      @default(0)  // 0-100
  eventType   String?
  entities    NewsEntity[]
  interps     Interpretation[]
  createdAt   DateTime @default(now())
}

model NewsEntity {
  newsId    String
  entityId  String
  relevance Float   @default(1)
  news      NewsItem @relation(fields: [newsId], references: [id])
  entity    Entity   @relation(fields: [entityId], references: [id])
  @@id([newsId, entityId])
}

model Interpretation {
  id                String   @id @default(cuid())
  newsId            String
  news              NewsItem @relation(fields: [newsId], references: [id])
  kind              InterpKind          // NEUTRAL | PERSONA
  personaKey        String?             // "buffett"
  payload           Json                // 结构化解读
  model             String
  disclaimerVersion String
  createdAt         DateTime @default(now())
  @@unique([newsId, kind, personaKey])
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
  subs      Subscription[]
}

model Subscription {
  userId   String
  entityId String
  user     User   @relation(fields: [userId], references: [id])
  entity   Entity @relation(fields: [entityId], references: [id])
  createdAt DateTime @default(now())
  @@id([userId, entityId])
}

enum EntityType   { SECTOR COMPANY STOCK PERSON }
enum RelationType { BELONGS_TO ISSUES WORKS_AT RELATED }
enum SourceTier   { PRIMARY MEDIA DERIVED }
enum InterpKind   { NEUTRAL PERSONA }
```

## 12. 里程碑 / 构建顺序

每个里程碑都可独立演示。

- **M0 脚手架**：T3 app + PostgreSQL + schema + PWA 外壳 + 部署（隧道）跑通
- **M1 实体地基**：seed 半导体板块 + 成分公司/股票 + 头部公司关键人物；实体页（先静态数据）
- **M2 数据管线**：1–2 个源跑通 抓取→去重→实体标注→入库；新闻时间线出现在实体页
- **M3 账号 + 关注 + feed**：email OTP 登录 + 关注实体 + 个性化 feed + 排序
- **M4 AI 解读**：中性解读（结构化）+ 巴菲特 persona（按需）+ 合规免责 & 过滤
- **M5 打磨**：搜索 / 发现、重大事件推送、埋点、合规复核

## 13. 决策记录（sway review 后确认）

1. **登录**：✅ email OTP（阿里云 DirectMail），输入验证码直接登录；手机号/微信后补。
2. **persona**：✅ MVP 只做**巴菲特**一个，先把质量跑通。
3. **数据源**：✅ MVP 接 6 源（巨潮 / 东财快讯 / 深交所互动易 / 集微网 / 华尔街见闻 / TrendForce），实测端点见 `docs/reference/data-sources.md`。
4. **半导体成分股口径**：✅ 东方财富半导体板块成分。
5. **域名**：✅ 验证阶段用 `jieniu.swaylab.ai`。

## 14. 成功标准（MVP 验证什么）

- 打开某只半导体股票 / 英伟达对标标的的实体页，能看到**近期真实的一手新闻时间线**，来源等级清晰。
- 关注 3–5 个实体后，feed 里**只出现我关心的**、且重要的排在前面。
- 一条重要新闻，中性解读**说人话、不瞎判断**；点开巴菲特视角，**像那么回事**、且明确非投资建议。
- 全程**零违规表述**（无买卖指令 / 点位 / 收益承诺）。
