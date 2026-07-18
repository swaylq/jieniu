# 产品调整方案：从「共享 AI 框架」到「你的投资逻辑」

日期：2026-07-13
触发：codex 产品视角评审（`/tmp/codex-review-jieniu-product.md`，要点已核实）+ agent 综合判断
状态：Stage 1 开发中

---

## 1. 诊断（已核实）

解牛现在更像「结构化的 AI 资讯工作台」，还不是它自称的「盯住**你的**投资逻辑的 Agent」。核心矛盾一条，且已对代码核实：

- **thesis 是实体级共享框架，用户无法拥有/编辑**。`Thesis` 表 `entityId @unique`、无 `userId`；全项目没有任何编辑 thesis 的 mutation（只有 `notifications.thesisAlerts` 只读）。thesis 由 `generate-thesis.ts` 按热门股 AI 生成，`entity.thesis` 公开返回。→「盯住*你的*投资逻辑」名不副实：盯的是 AI 给这只票生成的通用框架。

真正的护城河是那条**管线**：`一手材料 → 事件去重 → thesis 维度匹配 → 状态跨越 → 克制提醒 → 对照你的决策历史`——而**不是** AI 解读/大师视角（ChatGPT 一个 prompt 就复刻，反而稀释定位）。要兑现定位、建立数据护城河，thesis 必须**属于用户**。

其余已核实的短板：onboarding 落到 `/feed`（教育成「又一个资讯流」）；提醒只在站内（P3-6b 站外推送本就未做）；`/plus`、行情分析为占位。

## 2. 目标用户（收窄）

3–15 只集中持仓、按商业逻辑投资、怕错过关键变化但不想刷全市场的**中长线自主投资者**。不追求覆盖短线客/纯新手/机构级用户。

## 3. 分阶段方案（按杠杆排序）

| 阶段 | 主题 | 影响 | 状态 |
|---|---|---|---|
| **S1** | **thesis 属于用户**：采纳→编辑→按「我的维度/敏感度」个性化监控 | 高（解定位矛盾 + 建数据护城河） | ✅ 完成 |
| **S2** | 单股激活 onboarding：加一只持仓→复核 thesis→回填 30 天影响演示，落到标的档案而非 `/feed` | 高 | ✅ 完成 |
| **S3** | 提醒个性化（按用户 thesis 静音/重点）+ 复核闭环（已复核/不相关、新跨越重浮现） | 高 | ✅ core 完成；**站外送达(邮件/WebPush)+免打扰待基建** |
| **S4** | 提醒＝可审计证据链 + 版本/覆盖新鲜度 | 高 | ◑ 部分：thesis 新鲜度披露完成；逐句引用/完整证据链布局待续 |
| **S5** | 砍/降权非核心占位 | 中 | ◑ 部分：撤下行情占位卡 + sitemap `/plus` 完成；导航 sway 已在 P5-13 梳理干净（radar/digest 有内容，保留） |

> 本次会话（2026-07-13）落地 S1、S2、S3-core，并完成 S4/S5 的安全高价值部分。剩余：S3 站外推送（需 VAPID / 邮件告警 / WeChat 基建决策）、S4 完整证据链布局、S5 更深的首页 digest 降权——这些要么需基建/凭据，要么是更大的产品重排，留作独立迭代。

设计取舍：**管线保持实体级共享**（`classify-signals`/`detect-crossings` 仍一簇一次 signal，省 token），**个性化放在读取层**——用户的维度选择/敏感度在展示与提醒时对共享信号做过滤/排序。避免 per-user 重复分类导致成本爆炸，同时让「这是我的逻辑」成立。

## 4. Stage 1 详细设计（本次开发）

### 4.1 数据模型：`UserThesis`（叠加层，不动共享 `Thesis`）

```prisma
model UserThesis {
  id         String   @id @default(cuid())
  userId     String
  entityId   String
  reason     String?  // 一句话：我为什么持有/关注它
  horizon    String?  // long | swing
  dimensions Json     // UserDimension[]
  baseModel  String?  // 采纳时 base thesis 的 model（溯源）
  adoptedAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  entity Entity @relation(fields: [entityId], references: [id], onDelete: Cascade)
  @@unique([userId, entityId])
  @@index([userId])
}
```

`UserDimension = { key, watch, bull, bear, priority: boolean, sensitivity: "low"|"normal"|"high", muted: boolean, source: "base"|"user" }`

- `Thesis`（共享 AI 基础框架）= 「解牛基础框架」，保留，用于冷启动。
- `UserThesis`（每 user×entity）= 「我的投资逻辑」，采纳时从 base 快照而来，用户可编辑。

### 4.2 纯逻辑 `lib/user-thesis.ts`（TDD）

- `adoptDimensions(base: ThesisDimension[]): UserDimension[]`——全部采纳、`normal` 敏感度、非重点、未静音、`source:"base"`。
- `SENSITIVITY_THRESHOLD: { high:40, normal:60, low:80 }`——敏感度→材料度阈值（high 更易触发）。
- `personalizeSignals(dims, signals)`——滤掉 muted 维度；每维度按其 sensitivity 阈值滤材料度；重点维度优先排序。
- `activeDimensions(dims)`——非 muted 维度。
- `normalizeUserDimensions(input)`——业务规整（补默认、去空 key、限制字段）。

### 4.3 tRPC `userThesis` 路由（全 protectedProcedure、按 session user 隔离）

- `get({ entityId })` → `UserThesis | null`
- `adopt({ entityId, reason?, horizon? })` → 从 base 快照建 UserThesis（无 base 则报错）；upsert
- `update({ entityId, reason?, horizon?, dimensions })` → 覆盖，zod 校验
- `reset({ entityId })` → 从 base 重新快照（弃编辑）
- `remove({ entityId })` → 删除（回到 base 视图）

### 4.4 UI

- 实体页（server component）：登录用户多取 `userThesis.get`。
  - 有 UserThesis → 渲染 `MyThesisCard`（客户端，可编辑），signals 走 `personalizeSignals`。
  - 无 → 渲染现有 `ThesisCard`（base）+ `AdoptThesisButton`「设为我的逻辑」。
- `MyThesisCard`：展示「我的投资逻辑」标题 + 我为什么持有(reason) + 每维度控件（重点★ / 敏感度 低·中·高 / 静音）+ 保存 / 恢复默认 / 取消采纳。沿用 amber/line 设计系统，方向不用红绿。

### 4.5 验收标准

- 登录用户在有 base thesis 的标的上可「设为我的逻辑」，此后看到「我的投资逻辑」而非「AI 生成·监控用」。
- 可标重点、调敏感度、静音维度、写持有理由并保存；刷新后保持。
- 静音的维度不再出现在「近期触及逻辑」；低敏感度维度只留高材料度信号。
- 「恢复默认」重新对齐 base；「取消采纳」回到 base 视图。
- 未登录/无 base thesis 时行为不变。
- 迁移经空库全新部署 + 零漂移校验；`tsc` 与 `next build` 通过；lib 与 router 有测试。

### 4.6 明确留给后续阶段（不在 S1）

- 用户新增自定义维度的富文本编辑（S1 先支持采纳后的重点/敏感度/静音 + reason；增删维度进 S2）。
- 提醒真正按 user 敏感度触发 + 站外送达（S3）。
- 版本历史「我的逻辑何时因何而变」（S3/S4）。
