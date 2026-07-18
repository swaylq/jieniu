# 解牛 Phase 3 — 自选股「投资逻辑(Thesis)监控 Agent」

> 重定位:从「A 股新闻聚合 App」→「你自选股的投资逻辑监控 Agent」。原型 = ChatGPT「Oracle Thesis Watch」。信号而非噪音。

## 🎯 P3 融入优先级（loop `thesiswatch` 逐项做）

- [x] **P3-1 Thesis 基座** ✅：`Thesis` 模型(实体级共享缓存) + `generateThesis`(合规 JSON, maxTokens 3200) + `parseThesis`(容错解析, +5 单测) + `ThesisCard`(实体页顶部, amber/灰、兑现/风险非红绿、合规免责) + `generate-thesis.ts`(热门股按新闻数优先)。已给 6 家半导体龙头生成(各 6 维度)。196 测试过、build 过、真实实体页(中芯国际)截图确认。
- [x] **P3-2 自选股为中心的首页** ✅：首页主角改「我的自选股」hero(未登录=价值主张+登录 CTA;已登录空=建自选股 CTA;已登录有票=自选股 chips + 个性化时间轴 `feed.myFeed` + 查看全部动态);全站内容降级到「全市场」分区(border-t 分隔、小标题)。`feed.myFeed` 加 eventType 以复用 NewsTimeline。
- [x] **P3-3 新闻→维度命中 & 材料度** ✅：`ThesisSignal` 模型(denormalize 标题/时间) + Gate1 省 token 硬闸(`isMaterialCandidate`:一手公告/重磅/带事件才上 AI,routine 媒体挡下) + `classifyNewsAgainstThesis`(AI 判命中维度+方向+材料度,合规) + `parseSignals`(+9 单测) + `classify-signals.ts`(有 thesis 的实体、去重、MAX_NEWS 上限) + 卡片显示「近期 N 条动态触及逻辑 / 近期命中 N / 最新命中·方向·材料度·note」;安静时显示"静音中"。205 测试过、build 过、兆易创新页截图确认。**运维**:classify-signals 应在 ingest cron 后跑(增量)。
- [x] **P3-4 公司页围绕 thesis 重构** ✅：thesis 卡加「近期状态」摘要 banner(点出最受关注维度+方向,没料显"静音中") + 维度**按近期活跃度排序**(有信号的浮到前面) + 每维度"近期命中 N"徽标 + 「近期触及逻辑的动态」监控日志 feed(维度标签+方向+材料度+note+来源标题)。`thesis-status.ts`(dirLabel / thesisActivityStatus / sortDimensionsByActivity，+6 单测)。**AI 解读升级为"这条动没动你逻辑"拆到 P3-8。**
- [x] **P3-5 覆盖图谱(行业+竞品)** ✅：`entity.ecosystem` 查询(公司→所属行业 sector + 同板块**竞品**[`selectPeers` 去重/排除自己/截断,+3 测] + 行业与竞品各自近期资讯[竞品新闻只取 PRIMARY/重磅]);`EcosystemCoverage` 卡(所属行业 chips + 行业新闻 / 竞品 chips + 竞品动态带 amber 公司标签);实体页 thesis+feed 下渲染。214 测试过、build 过、预览卡 + 真实兆易创新页(半导体 + 4 竞品)确认。竞品=同板块近似(显式 RELATED 边 / AI 补清单留后续)。
- [x] **P3-6 材料变化推送（站内）** ✅：`notifications.thesisAlerts`(关注实体里材料度 ≥ `MATERIAL_ALERT_THRESHOLD`=40 的信号 + 补实体名) + `ThesisAlerts` 组件(公司 + 维度 amber 标签 + 方向 + 材料度 + why note + 来源资讯,复用 seen 水位线显"新") + /notifications 页顶部「投资逻辑异动」区(其下保留旧「重磅资讯」列表);`isThesisAlert`(+1 测)。**只推动了逻辑的、够材料的变化,非到价、非噪音。** 215 测试过、build 过、预览卡截图确认(材料度 72/58 未读带 amber 环、45 已读无环)。**站外推送通道(Web Push/邮件)+ 用户级开关拆到 P3-6b(需基建)。**
- [x] **P3-7 分层(普通/Plus)** ✅：`lib/plan.ts`(PlanTier STANDARD|PLUS + planFeatures/hasFeature/normalizePlan + FEATURE_LABEL/PLAN_META，+3 测) + `User.plan` **权限位**(默认 STANDARD) + `billing.myPlan` 查询 + `/plus` 对比页(普通 ¥88 盯资讯 vs Plus ¥188 盯行情，功能勾选表，**支付按钮占位**"升级 Plus·即将开放") + `MarketAnalysisCard`(实体页 aside，Plus 独占 AI 行情分析，STANDARD 显 🔒升级位→/plus) + profile「会员」入口。218 测试过、build 过、/plus + 兆易创新 aside 截图确认。合规:行情分析仅客观归纳、非建议。**热门股优先**已在 P3-1(generate-thesis 按新闻数)/P3-3(只对有 thesis 实体)落地。
- [x] **P3-8 thesis 感知 AI 解读** ✅：资讯详情页 aside 顶部加「动没动你的逻辑」卡——`interpret.thesisLens`(按实体分组该资讯**预先算好的**信号) + `summarizeEntityLens`(取最材料信号定调，+2 测) + `ThesisLensCard`(每实体聚合方向 + 逐维度 命中·方向·材料度·note)，置于通用「AI 解读」之上。**复用 P3-3 已算信号、零新增 AI 调用**（省 token）。220 测试过、build 过、真实资讯页截图确认(兆易创新·中性·毛利率与费用率·材料度 25)。

**✅ Phase 3 主线 P3-1~P3-8 全部落地。** 仅余「需基建/后续」分组。

### 需基建 / 后续（不占 loop 每轮"第一个未打勾"）
- [ ] **P3-6b 站外推送通道 + 开关**（需基建）：Web Push / 邮件把材料异动推到 App 外;用户级推送开关 + 免打扰时段。依赖 classify-signals 接在 ingest cron 后增量跑（运维项）。

## 三支柱
1. **降噪**:只有你的自选股 + 其行业 + 竞品;其余 5000 只默认静音。
2. **Thesis Watch**(核心差异化):每票一份投资逻辑框架——维度(各含"盯什么"+bull信号+bear信号) + bull case + bear case + 关键价位(观察位)。资讯进来 → 命中哪个维度 + 材料度 → 够格才提醒。
3. **Thesis 感知 AI 解读 + 分层 + 推送**。

## 数据模型（新增）
```prisma
model Thesis {
  id         String   @id @default(cuid())
  entityId   String   @unique
  entity     Entity   @relation(fields: [entityId], references: [id], onDelete: Cascade)
  summary    String   // 一句话投资逻辑
  bullCase   String   // 多头逻辑(要盯的兑现点)
  bearCase   String   // 空头风险(要盯的恶化点)
  dimensions Json     // [{ key, watch, bull, bear }]
  keyLevels  String?  // 关键价位观察(非买卖点)
  model      String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
// 后续:ThesisSignal(newsId×dimension×materiality)、UserThesis(个性化覆盖)
```
Thesis 是**实体级共享缓存**(热门股生成一次,全体用户共用基线;个性化 UserThesis 后续)——省 token、契合"先做热门股"。

## 锁定决策
- Thesis 全部由 **AI 生成**(加股→自动产出,可选改)。
- 分层:普通盯资讯 / Plus 盯行情;**支付占位、暂不接**。
- 数据 v1:**资讯/公告级**命中;数值级(财务/行情)后续基建。
- **先做热门股**。

## 合规
不荐股——监控**用户自己的**逻辑、只标材料变化由用户判断。关键价位=观察位非买卖点;bull/bear=市场论点非我方建议。thesis 生成 prompt 必带合规约束(复用 `COMPLIANCE_CLAUSE` 精神:不出买卖指令/目标价承诺/收益预测)。颜色铁律不变。

## 诚实的数据缺口
- 真·财务数值(capex/RPO/逐季毛利率)、行情(K线/资金流)不在现有来源 → v1 做资讯/公告级命中,数值级留后续(Plus 底座)。
- 竞品关系先用同细分板块近似 + AI 补,不完美但能跑。
