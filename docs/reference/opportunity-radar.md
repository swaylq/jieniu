# 机会雷达 — 实现说明与运行手册

2026-07-31 改造。本文只写**已经落地**的内容；未实现的写在最后「已知缺口」一节。

## 一、模块划分

`/discover` 页现在有两个**刻意分开**的模块：

| 模块 | 回答什么 | 不回答什么 |
|---|---|---|
| **市场强弱地图** | 今天哪些行业强、哪些行业弱（板块涨跌、涨/跌家数、成交额、主力资金） | 不把强势或跌得多的行业称作「机会」 |
| **机会雷达** | 哪些变化可能仍处于早期、值得进一步研究 | 不出买卖建议、不预测涨跌 |

每天上限：**3 个行业信号 + 每行业最多 2 只个股 + 总数 ≤ 8**。没有合格信号就显示
「今日暂无高置信度的新机会。」——不为填满页面降低标准。

## 二、数据来源

| 数据 | 来源 | 说明 |
|---|---|---|
| 逐日收盘 / 涨跌幅 / 主力净额 / 主力净额占成交额比 / 换手率 | **新浪** `MoneyFlow.ssl_qsfx_zjlrqs` | 一次请求回最多 200 个交易日，实测 0.33s / 17KB |
| 成交额 | 由 `主力净额 ÷ 占比` 反推 | 与 K 线 `close×volume` 交叉验证过（茅台 7/30：97.1 亿 vs 97.9 亿） |
| 流通市值 | 由 `成交额 ÷ 换手率` 反推 | 与腾讯快照对过（000812：26.5 亿 vs 26.39 亿），**不用再打第三方** |
| 一字板 / 连续涨停 | 新浪 K 线（四价） | 只对最终入选的 ≤8 只拉，不是全市场 |
| 催化证据 | 站内 `NewsItem` + `NewsEntity` | 分级复用 `lib/evidence-source.ts` 的六级来源分级 |
| 板块归属 | 解牛自己的 `STOCK --BELONGS_TO--> SECTOR` | 与板块页、热门覆盖同一套口径 |

**为什么不用东财**：`push2` 对本节点是间歇封锁（2026-07-31 实测 clist 连打 5 次全空），
且它只给「今天这一格」，给不了雷达需要的 60 日历史。原来的
`EntitySignal(kind="flow")` 是 `@@unique([entityId, kind])` 的单行 upsert，
每天覆盖、历史一天不留 —— 那是这次必须新建 `MarketDaily` 的根本原因。

## 三、数据结构

### `MarketDaily`（新）
逐日行情+资金：`(ticker, tradeDate)` 唯一。字段：`close / changePct / amount /
netAmount / netRatio / turnoverRate`。

### `OpportunitySignal`（新）
`signalType(EARLY|CONFIRMED|RELATIVE_STRENGTH)` · `entityType(SECTOR|COMPANY)` ·
`entityId` · `signalStrength(STRONG|MEDIUM)` · `internalScore` · `reasons[]` ·
`risks[]` · `metrics{}` · `catalystNewsIds[]` · `narrative{}` · `tradeDate` ·
`generatedAt` · `updatedAt` · `expiresAt` · `status(ACTIVE|CONFIRMED|EXPIRED|RISK)`。

`@@unique([dedupeKey, tradeDate])` —— `dedupeKey` 个股=ticker、行业=板块名。
**库层挡住「同一家公司以 COMPANY + STOCK 两个实体重复入选」**，不靠调用方自觉。

## 四、代码结构

```
src/lib/radar/            纯函数层（无 IO、无 AI、全部有单测）
  sina-flow.ts            新浪资金流解析
  series.ts               时序基元：N 日涨幅 / 分位 / 自身分位 / 量比
  aggregate.ts            个股序列 → 行业聚合 + 全 A 基准
  score.ts                §3 资金强度 / §4 行业分 / §5 个股分 / §6 催化 / §7 拥挤
  gates.ts                §2 三种信号的闸门
  select.ts               §1 配额 + §5 基础过滤 + 孪生实体去重
  catalyst.ts             §6 催化分级（体裁白名单 + 主体校验）
  lifecycle.ts            §9 升级 / 失效 / 转风险
  narrative.ts            §8 六段人话（确定性底稿）
  engine.ts               把上面串起来，输出信号草稿 + 诊断
  backtest.ts             §12 前瞻收益 / 超额 / 最大回撤

src/server/radar/
  load.ts                 取数（市场日历对齐、催化窗口、asOf 回放）
  limit-shape.ts          一字板 / 连续涨停核验
  generate.ts             管线：引擎 → 一字板 → AI 润色 → 落库 + 生命周期

src/server/api/routers/radar.ts   strengthMap / opportunities
src/app/_components/market-strength-map.tsx
src/app/_components/opportunity-radar.tsx

src/scripts/
  backfill-market-daily.ts   逐日行情回补（有界分片、幂等）
  generate-radar.ts          信号生成（--ai / --asOf=）
  radar-backtest.ts          历史回放 + 效果统计（只读）
```

## 五、运行

```bash
# 首次/补历史（一次跑全市场约 100–200 秒）
NODE_ENV=development npx tsx src/scripts/backfill-market-daily.ts --limit=6000 --days=140 --minDays=130 --concurrency=8

# 日常：刷最近几天 + 生成信号（调度器 job `opportunity-radar` 已注册，默认 disabled）
NODE_ENV=development npx tsx src/scripts/backfill-market-daily.ts --limit=6000 --days=8 --minDays=99999
OPENROUTER_MODEL=deepseek/deepseek-chat secret exec OPENROUTER_API_KEY -- npx tsx src/scripts/generate-radar.ts --ai

# 回测
NODE_ENV=development npx tsx src/scripts/radar-backtest.ts --days=25 --horizon=10
```

调度器里的 `opportunity-radar` **默认 `enabled=false`**（`ensureStates` 建行就是
disabled），要在 `/admin/jobs` 显式开启。

## 六、模型分工（§11）

- 数值、筛选、排序：**全部纯函数**，零 AI。
- 六段人话：先出**确定性底稿**（数字全部来自 `metrics`）。
- 强模型只**润色**最终入选的 ≤8 条，且有两道闸：
  1. 提示词禁止新增/修改数字、禁止改变数字含义；
  2. `numbersAreSubsetOf()` **机械校验**——成品里出现的数字必须在底稿里出现过，
     否则那一段退回底稿（实测一轮生成里拦下 4 段）。
- AI 不可用时底稿原样入库，页面照常可用。

## 七、已知缺口

1. **主力资金是估算值**：新浪/东财都按成交单笔金额分档估算，非交易所披露。
   前台已注明，且资金**永远不能单独决定入选**——每条闸门里它都只是合取式的一项。
2. **催化只覆盖站内已采集的资讯**。研报覆盖率约 29.5%，行业数据（销量/价格指数）
   基本没有独立数据源，所以「中」档催化偏少。
3. **没有分红/送转的复权因子表**：N 日涨幅改用官方日涨跌幅连乘规避了这个问题，
   但「N 日前的价格」这类展示仍会用未复权收盘价。
4. **行业分类是解牛自己的一套**（131 个有成分股的板块），与东财/申万口径不同，
   跨平台对不上是预期内的。
5. **个股信号的回测样本仍然偏少**：见 `docs/reference/radar-backtest.md`。
