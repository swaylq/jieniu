# 解牛 Phase 4 — Personal Investment Intelligence Agent（个人投资智能 Agent）

> 从「资讯监控」跃迁到「**认知维护**」。产品每天只回答一件事：
> **今天发生的事，是否改变了你原来的投资逻辑？** 渲染版产品文档见 Artifact（本 loop `piagent` 锚点）。

## 0. 定位（一句话）
不是新闻 App / 行情软件 / 聚合器，而是 **Decision Support System**：一个 24h 在线、永远记得你为什么买、持续验证你投资逻辑、只在真正重要时才提醒你的私人投资研究员。核心原则:**减少用户的信息输入,而不是增加**;宁愿少提醒,也不乱提醒。

## 1. 三个终极问题
1. 今天有没有发生重要事情？
2. 这件事和我的持仓有没有关系？
3. 它有没有改变我当初买这只股票的理由？

## 2. 与解牛现状的关系（承接 Phase 3 + ZF）
| 愿景要素 | 现状（已有） | Phase 4 缺口 |
|---|---|---|
| Investment Thesis | ✅ `Thesis`(summary/dimensions/bull/bear/keyLevels) + `generateThesis` | 缺 **catalysts / invalidation conditions** 显式化 |
| 新闻→逻辑命中 | ✅ `ThesisSignal`(news×dim×direction×materiality) + classify | 缺 **Event 合并**(300 篇→1 事件) |
| 材料提醒 | ✅ `notifications.thesisAlerts`(材料度≥40) | 缺 **只在 thesis 改变时推**(thesis 快照 diff) |
| 自选股 | ✅ `Watchlist`(userId+entityId) | 缺 **Portfolio**(成本/仓位/目标) |
| thesis 感知解读 | ✅ 资讯页「动没动你的逻辑」 | 缺 **主动挑战用户**(drift guard) |
| — | — | 缺 **User Memory**(投资画像) / **Decision Memory**(决策史) |
| 首页 | ✅ 自选股为中心 + 早报 | 升级为 **Today Your Portfolio Changed** |

结论:解牛已有 thesis 的「骨架」;Phase 4 补齐**四层长期 Memory**(护城河)+ **事件级理解** + **会挑战你的 Agent**。

## 3. 四层长期 Memory（真正的 Moat）
```prisma
// 第一层 用户画像（投资风格/风险偏好/思考方式）
model InvestorProfile {
  id String @id @default(cuid())
  userId String @unique
  style String?      // 成长/价值/短线/长期…（可多值,存 JSON 或逗号）
  riskLevel String?  // 保守/稳健/进取
  traits Json?       // {leftSide:bool, dipBuyer:bool, valuationSensitive:bool, ...}
  summary String?    // AI 从 Decision 历史归纳的一句话画像
  updatedAt DateTime @updatedAt
}
// 第二层 持仓（成本/仓位/目标）——无券商接入,用户手录
model Holding {
  id String @id @default(cuid())
  userId String
  entityId String
  status String   // HOLDING | WATCH | CLOSED
  costBasis Float?    // 成本价（观察用,不做盈亏建议）
  shares Float?       // 股数 或
  weight Float?       // 仓位占比 %
  targetWeight Float? // 目标仓位 %
  note String?
  openedAt DateTime @default(now())
  closedAt DateTime?
  @@index([userId])
}
// 第三层 投资逻辑（扩展现有 Thesis）——加显式 催化剂 / 证伪条件
//   Thesis 增 catalysts Json?  // [{text, dimensionKey?}]
//                invalidations Json? // [{text, dimensionKey?}]  ← "什么情况证明我错了"
// 第四层 决策记忆（为什么买/卖/加/减 + 当时依据）
model Decision {
  id String @id @default(cuid())
  userId String
  entityId String
  action String   // BUY | ADD | TRIM | SELL | HOLD_REAFFIRM
  reason String   // 当时的理由（用户自述）
  price Float?
  thesisSnapshot Json? // 决策时的 thesis 状态（供未来 drift 对比）
  createdAt DateTime @default(now())
  @@index([userId, entityId])
}
```

## 4. 每日 Agent 循环（6 步 · 多 Agent）
1. **Collect**（Collector, =现 ingest）: 公告/媒体/(后续:财报/电话会/研报/资金流)。
2. **Event 合并**（Event Agent）: rule 预聚类(标题相似+同实体+时间窗) → AI 命名归并 → **1 个 Event** 而非 N 篇。
3. **Entity 传播**（Entity Agent）: Event → 影响哪些实体(现有 relations + 后续供应链)。
4. **Thesis 更新**（Thesis Agent, ≈现 classify-signals 升级）: Event 触及哪些维度 + 方向 + 材料度 → 更新 thesis 维度状态,写 **thesis 快照**。
5. **Personal 结合**（Personal Agent）: 叠加该用户 Portfolio/Profile/Decision → 算优先级(持仓+担心的维度=最高;未持仓=不提醒)。
6. **Alert 决策**（Alert Agent）: thesis **有没有真的改变**? 变了→推;没变/噪音→静音。**宁少毋滥**。

## 5. 首页：Today Your Portfolio Changed
不是新闻流/资讯流/推荐流。是「**今天你的组合变了什么**」。
- 顶部:「今天共 N 个重要变化」或「今天无变化,已为你静音」。
- 每条:股票 · **投资逻辑方向**(增强/削弱/未变,amber/灰非红绿) · 原因(哪个维度动了) · **观察建议**(非买卖:"继续观察,不建议机械加仓")。

## 6. Agent 的立场：挑战，而非附和（Thesis Drift Guard）
用户加仓/决策时,Agent 对照 **原始 thesis + Decision 历史 + 最近信号**主动质疑:
> 你第一次买 X 的理由是「高现金流」。现在现金流维度已转弱。你现在加仓的理由,是否已变成「因为跌了」? 请重新确认。

目标:帮用户避免 **Thesis Drift**(投资逻辑漂移)。Agent 回答「**所以呢**」不是「发生了什么」。

## 7. AI vs Code 边界（铁律）
- **AI**:理解 / 推理 / 关联 / 解释 / 长期 memory / 决策支持。
- **Code**:行情 / 价格 / 财务计算 / 资金流 / SQL / rule engine。
- **所有数字必须来自数据库,AI 永不自己编数字。** 缺数据就说缺,不脑补。

## 8. 继承的铁律
- **合规**:不荐股 / 不点位 / 不承诺收益;thesis=监控框架非建议;关键价位=观察位;bull/bear=市场论点;成本/盈亏只做「观察」不做操作建议;drift 挑战=促用户自查,非指令。
- **颜色**:红/绿只给真实价格涨跌;thesis 方向/材料度/评分一律 **amber/灰**。
- **省 token**:AI 只对**持仓/热门股/有 thesis 且有变化**的实体;Event 合并前 rule 预聚类;分类先关键词预筛;增量(别重复已算);打扰前 rule 预筛;冷门股不烧。

## 🎯 P4 构建 backlog（loop `piagent` 逐项做）
- [x] **P4-1 Portfolio Memory**：✅ `Watchlist` 原地扩展(status WATCH|HOLDING|CLOSED + costBasis/shares/weight/targetWeight/note，非破坏，follow/feed/notification 无感) 作 Holding 载体 + 「持仓/观察」两态 + `HoldingEditor`(个股页手录成本/仓位/目标，仅观察) + `portfolio` router(list/get/upsert) + profile 拆「我的持仓/我的观察」。`src/lib/portfolio.ts` 纯逻辑 +5 测试(状态归一/数值清洗/切分/总仓位/目标缺口)。
- [x] **P4-2 Investment Thesis 升级**：✅ `Thesis` 加 `catalysts`/`invalidations` Json(空安全 `asStringArray` +3测);`THESIS_SYSTEM`/`thesisUserPrompt` 产出两组具体可观测条件(maxTokens 3200→3600);`generate-thesis.ts` 持久化;`ThesisCard` 展「关键催化剂(amber)/证伪条件(灰)」+entity 页回读。真 AI 重生成中微公司验证:催化剂/证伪皆具体可观测、amber/灰无红绿。这是「什么情况证明我错了」的锚(drift guard 基准)。
- [x] **P4-3 Decision Memory**：✅ `Decision` 模型(action BUY|ADD|TRIM|SELL|HOLD_REAFFIRM/reason/price?/thesisSnapshot Json?) + `decision` router(listByEntity/listMine/create，create 时快照当刻 thesis summary+催化剂+证伪) + `DecisionEditor`(动作 pills+理由+可选记价，个股页登录态) + `DecisionList`(时间线，amber 建仓侧/灰 减仓侧，非红绿) + 个股页决策卡 + profile「最近决策」。`src/lib/decision.ts`(normalizeAction/actionTone/isValidReason/sortDecisionsDesc)+6测。存 thesisSnapshot 供 P4-5 drift 对比。
- [x] **P4-4 Today Your Portfolio Changed（首页重构）**：✅ 登录态首页头部(MarketStrip 下)新增「今天你的组合变了什么」。`portfolio.changed` query(仅 HOLDING，取近7天 thesisSignals，纯 DB+rule 无 AI) + `src/lib/portfolio-change.ts`(rollUpHoldingChange 仅材料级≥阈值才算「变」/bull-bear 汇总定增强削弱/partitionPortfolioChange 有料在前/changeTone amber-灰/changeObservation 自查提示)+7测。`PortfolioChanged` 组件:每票 方向(逻辑增强 amber/削弱 灰/未变)+原因+观察建议(非指令)，无异动折叠「已静音」，无持仓显引导。预览四态截图确认、amber/灰无红绿、免责在位。
- [x] **P4-5 Thesis Drift Guard**（旗舰差异化）：✅ 录入 BUY/ADD 时触发。`src/lib/drift.ts`(driftDecision:只挑战建仓侧且近期有偏风险信号——bear>bull=strong/否则 soft；driftHeadline；fallbackChallenge 规则兜底)+7测。`decision.driftCheck` mutation:Code 从 DB 取事实(近30天材料级 bull/bear 信号数、最早买入理由、thesis catalysts/invalidations)，仅 shouldChallenge 时调 AI(省 token)。`generateDriftChallenge`(DRIFT_SYSTEM:促自查/不评判/不编数字/结尾"最终决策在你")。`DriftGuardCard`(amber/灰) + DecisionEditor 集成(BUY/ADD→driftCheck→挑战卡「我已重新评估确认录入/再想想」，check 失败不阻断)。真 AI 验证:复述原逻辑+仅用给定风险事实+关键一问"逻辑仍成立还是仅因跌了"+免责，无编造。这是与所有行情工具的根本分野。
- [x] **P4-6 User Memory（投资画像）**：✅ `InvestorProfile`(style/riskLevel/holdPeriod/traits/summary) + User 关系。`investor-profile.ts`(问卷选项 STYLE/RISK/HOLD + normalize + **adjustDriftLevel 回灌**:激进→升级 strong、保守→温和 soft + driftToneHint + hasProfile)+7测。`investorProfile` router(get/save 部分安全/summarize 从决策 AI 归纳≥3条才调)。`summarizeInvestorProfile`(自我认知镜子，非风险测评、不编数字)。`InvestorProfileCard`(profile 页问卷 pills + AI 总结)。**画像回灌 drift**:driftCheck 读 riskLevel → adjustDriftLevel 调档 + driftToneHint 调语气。四层 Memory 护城河至此齐备。amber/灰、合规免责在位。
- [x] **P4-7 Event 合并**：✅ `NewsEvent`(title/summary/entityId/count/first-lastSeenAt) + `NewsItem.eventId`。`event-cluster.ts` 纯 rule 预聚类(charBigrams/jaccard/titleSimilarity/entitiesOverlap/clusterNews:实体重叠+标题相似≥0.5+24h 窗，代表标题取最居中)+9测。`cluster-events.ts` 脚本(纯 rule 无 AI)——真数据跑通:1918 篇→1779 簇、**114 个多篇 Event**(如"沪深成交破3万亿"5篇、"创业板指跌超5%"3篇)。UI:NewsCard「同题 N 篇」amber 徽标(可选 prop 非破坏)+entity newsById 带 event.count。省 token:同事件一次 signal 替代逐篇（signal 去重可后续接）。AI 命名可选后续。
- [x] **P4-8 Alert 决策升级（只推 thesis 改变）**：✅ `dimension-state.ts`(dimensionState 汇总方向→中性/偏兑现/偏风险 + crossedState:变了且转到有方向才算跨越，转中性=平息不推)+5测。`ThesisDimensionState` 表(state + lastCross* 快照)。`detect-crossings.ts` 脚本(材料级信号汇总当前状态 vs 上次 diff，仅跨越记 alert，纯 rule 无 AI)——真数据跑出 1 跨越(现金流与资本开支 中性→偏兑现)。`notifications.thesisAlerts` 改读跨越(近30天)而非逐条材料信号。`ThesisAlerts` UI 展「维度：中性 → 偏风险」(偏兑现 amber/偏风险 ink，非红绿)。宁少毋滥升级。
- [x] **P4-9 Event 传播链 / Impact**：✅ `impact.ts`(propagateImpact:源实体经 EntityRelation 图扩散到用户其它持仓，竞品 RELATED 0.7 > 同板块 BELONGS_TO 共享 0.5，源自身不计、去重取最高、按相关度排序)+5测。`portfolio.impact` query(源=有异动持仓 rollUpHoldingChange，取 BELONGS_TO/RELATED 边，纯图遍历+rule 零 AI，<2 持仓/无异动返回空)。`PortfolioImpact` 组件(首页 PortfolioChanged 下)：「X 逻辑削弱 → 可能波及 同板块 Y、竞品关联 Z」，hedged 措辞(可能/往往/不代表必然联动)、增强 amber 削弱灰、非因果非荐股。285测试过、build过、预览截图确认。（原意：Event → 受影响实体经现有 relations 扩散，组合页显示「这条事件如何波及你的持仓」。）

### 需基建 / 后续（不占 loop 每轮"第一个未打勾"）
- [ ] **P4-10 数值级监控**：真财务数值(capex/FCF/RPO/逐季毛利率)、资金流、K线形态——需另接数据源;Plus 底座。
- [ ] **P4-11 更多信息源**：财报/电话会纪要/卖方研报/社媒情绪——现无来源。
- [ ] **P4-12 券商持仓接入**：自动同步真实持仓(现为手录)。

## 诚实的数据缺口
- 现有源=交易所公告(东方财富·公告,含正文)+ 媒体(华尔街见闻/东方财富·快讯/集微网)+ 行情(quote/kline)。**电话会/研报/社媒/资金流/逐季财务数值不在其中** → 相关能力列 P4-10/11,不脑补数字。
- 持仓成本/仓位**用户手录**(无券商接入);产品只做「观察」不做盈亏操作建议(合规)。
- 事件传播链 v1 用现有实体关系近似;真供应链图谱后续。
- 示例文档用了美股(Oracle/NVIDIA)阐释**概念**;解牛落地在 **A 股**,thesis 维度按 A 股生成(已实现)。

## 承接
延续 [2026-07-05-thesis-watch.md](2026-07-05-thesis-watch.md)(P3 thesis 监控)与 [2026-07-05-zcb-feedback.md](2026-07-05-zcb-feedback.md)(张楚寒反馈)。四层 memory 是护城河,事件级理解 + 会挑战你的 Agent 是差异化。
