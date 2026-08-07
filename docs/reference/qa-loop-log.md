# 产品自查+修复 loop 台账（每小时 :43，loop 6452d75e）

**用途**：每轮主动找「类似催化临近不可点」这类产品问题，安全的修、风险大的记。让每轮不重复劳动、维度轮换不漏。

**判决规则**：问题必须带证据（HTTP 码 / DOM 片段 / DB 数字 / 日志行），不许凭猜。HTTP 200 ≠ 健康（AI/邮件要功能级验证）。安全机械的修复本轮 TDD 修 + start-prod.sh 部署；风险大/含糊/需产品决策的进下面 backlog。

**维度轮换**（每轮挑上轮的下一个）：
a. 交互性/可点性 → b. 显示 vs 全量/最新数据 → c. 静默故障 → d. 覆盖缺口 → e. 坏链/404/500 → f. 文案准确性 → g. 数据新鲜度 → h. 空状态/边缘 → **i. 去AI化/人味文案** →（回到 a）

**★ 维度 i（去AI化，sway 2026-07-27 加入）**：UI 文案是否有 AI 生成的痕迹，逐屏改写成简洁、人味的文案。**AI 味 tell**：破折号 `——` 连接从句成瘾；装饰性 emoji 抬头(🐂🎯🗓️🕰️🕸️📌)；营销套话(一站直达/第一时间触达/打造/私人投研)；讨好式 hand-holding(替你/帮你/为你 叠用)；格言煽情(宁静也是信号)；免责堆砌(三连"非投资建议、不构成买卖依据、不预测涨跌")；对仗排比(不是X而是Y)；冗余解释。**红线：合规免责(非投资建议，铁律②)只收敛成干净一行、绝不删**。**做法**：每个 i 轮humanize 一屏，before/after 记录，改了就 build+start-prod.sh 部署验证。**目标声音**：简洁、笃定、具体，像人写的专业财经产品文案，不像 chatbot。**进度（2026-07-27 sway「按推荐做直到做完」→ 全站一次扫完 ✓）**：装饰 emoji 抬头全去(14 处 🐂🎯🗓️🕰️🕸️📌📈🔔→统一换成 `bg-brand` 竖条 marker)；prose de-slop 覆盖 首页 hero+关于/briefing/portfolio-changed/workbench/entity 页(SEO desc+我的卡)/thesis-card/my-thesis/portfolio-impact/ecosystem/signal-strip/onboarding/discover/notifications/decision-editor/seo.ts SITE_DESCRIPTION——去破折号从句、去替你/帮你/为你、去一站直达/第一时间触达、去宁静也是信号、免责三连收敛成一行(保留非投资建议)。**保留**：合规免责(收敛不删)、品牌定位(私人投研 Agent eyebrow)、催化日历/记分卡等事实性说明。线上实测 5 大页面 emoji=0。此后新增文案默认按此声音；i 轮转到时做增量巡检。

**上轮维度**：h（run 61，2026-07-29，第 7 轮）→ 下轮 i（第 7 轮末）

---

## Backlog（发现但本轮没修，等排期/产品决策）

### ★ sway 直报（2026-07-28 四条 + 07-29 追加一条，已定位根因）

sway 原话：①敏感度中高低调整后无实时反馈 ②下面的资讯/公告 tab 切换后页面会到最上方 ③关系这边很多公司都没有数据 ④有些数据没抓到，比如宁德时代上周五出的半年报 ⑤（07-29 追加，附侧栏截图）自选列表里有的有股票代码、有的没有。**状态：五条全部修完并部署（2026-07-29 收官）。** ① 由另一 session 于 07-28 修掉；②③④⑤ 由 `swayfix4` loop run 1–4 依次修完，每条都有线上定向验证。留在 backlog 的后续项见各条目末尾（`RELATED` 关系源、加自选归一、COMPANY 补 ticker 字段、`ecosystem.ts:selectPeers` 已无引用可清理）。

- ~~**⑤（中·一致性）自选列表「有的有代码有的没有」**~~ **✅ 2026-07-29 已修并部署（swayfix4 run 3）**：走推荐的 (a) 档「显示层统一」。新增 `src/lib/watch-label.ts`：`splitNameCode` 把烙在 STOCK 名字里的 `(6位代码)` 拆出来（正则写死 6 位，不误伤「某某(集团)」，`-U`/`-UW` 上市状态后缀留在名字里），`watchEntityLabel` 产出「主行=名字 / 副行=代码」，代码优先用自己的、没有就借发行股票的、再没有（板块/人物/未上市公司）才退回类型标签。`watchlist.list` 与 `portfolio.list` 各加一段 `relFrom(ISSUES).to.ticker` 的嵌套 select（不多一次往返），侧栏 `sidebar.tsx` 与 `/profile` 两个渲染点都换成同一套口径。**真实数据冒烟**：全站 4 个用户 20 条自选，改后**公司/股票仍无代码的 = 0**。**线上端到端**（走项目自带的真实登录流程播种一次性 OTP → 服务器自己签发 cookie，不手工铸 JWT）：`/profile` 实际渲染出 sway 截图里那 7 条，**7 条全带代码、0 条仍显示「公司」「股票」**。**未做**：孪生实体本身仍可各自被加自选（(b) 档归一 + 迁移），只是现在两份长得一样了；(c) 档给 COMPANY 补 ticker 字段也没做。原始定位留档如下 —— **同一家公司在库里有 COMPANY / STOCK 两份，代码只烙在 STOCK 的名字里**。截图里「国盾量子 / 长鑫科技」标注是**公司**、无代码，「东山精密(002384) / 大普微-UW(301666) / 摩尔线程-U(688795) / 新易盛(300502) / 江波龙(301308)」标注是**股票**、带代码。直查库坐实两点：(a) **STOCK 的 name 100% 带 `(6位代码)`（抽样 2000/2000），COMPANY 0%（0/2000），且 COMPANY 的 `ticker` 字段 5498 家全为 `null`** —— 每家公司都是一对孪生实体（`COMPANY:"国盾量子" ticker=null` ↔ `STOCK:"国盾量子(688027)" ticker=688027`）；(b) **全站 `Watchlist` 混着两种：COMPANY 15 条 / STOCK 5 条**。侧栏 `sidebar.tsx:220` 只渲染 `{e.name}`，所以加的是哪一份就长哪样。为什么会混：`entity.search` 有意把 STOCK 归并到「规范 COMPANY 页」（`dedupeSearchResults` 还专门借发行股票的代码来显示），所以**从搜索加自选 → COMPANY（无代码）**；而从发现页/板块成员/资讯实体 chip 点进去可能是 STOCK → **加的是 STOCK（有代码）**。
  修法三档（待定）：(a) 最小——watchlist 查询照搬搜索那套「借发行 STOCK 的 ticker」，侧栏渲染 `name + 代码`，显示层立刻齐整；(b) 中等——加自选时统一归一到规范实体（COMPANY），并迁移已有那 5 条 STOCK 自选；(c) 根治——给 COMPANY 补 `ticker` 字段（或反过来把代码从 STOCK 的 name 里剥掉、只走 ticker 渲染），让「代码」是字段而不是字符串习惯。
  **注意**：这条跟 ③ 是同一个根（COMPANY/STOCK 孪生实体，各类数据挂载端不统一），但**资讯绑定是双绑的、没问题**（抽样 6 万条：COMPANY 28108 / STOCK 24005；国盾量子 COMPANY 128 条 vs STOCK 124 条）。所以别把 ⑤ 当成「COMPANY 那份是残废实体」——它缺的是代码和 `BELONGS_TO`，不缺资讯。
- ~~**①（高·功能失效）敏感度 高/中/低 调了没反应**~~ **✅ 2026-07-28 已由另一 session 修掉**（spec `docs/specs/2026-07-28-sensitivity-wired.md`，代码已落：`my-thesis-card.tsx` 的 `patchNow` 开关即存 + 整页刷新、`thesisAlerts`/`buildAlertEvents` 接同一道阈值闸、新脚本 `src/scripts/backfill-signals.ts` + cron 补信号，复用 `isDigestWorthyFiling` 过滤后信号 1 → 25 条）。遗留：`MATERIAL_ALERT_THRESHOLD=40` 全局门槛没降，所以「高」档等价全放行、再调没有更宽余地。原始定位留档如下 —— **这个旋钮全站没有可作用的对象**。`my-thesis-card.tsx:65` 的 `shown = personalizeSignals(dims, signals)` 确实随 dims 实时重算，唯一可见反馈是「近期触及你的逻辑 · N」这条列表。但直查库：**全库 `ThesisSignal` 只有 11 条、分布在 3 个实体上**（5500 只股里的 3 只），materiality 分布 `<40: 10 条 / 40–59: 1 条 / ≥60: 0 条`；而阈值是 `high=40 / normal=60 / low=80`（`user-thesis.ts:26`）。即：**最敏感档最多留 1 条，中/低档恒为 0 条**，其余 99.9% 的股列表恒空 → 点高/中/低屏幕上一个字都不变（只有药丸底色换色）。不是前端 bug，是**信号管线几乎没产出**。修法两层：(a) 补 ThesisSignal 生成（根问题）；(b) 在有无信号时都给即时反馈——按当前档位显示「会提醒 N 条 / 已静音 M 个维度」这类计数（`activationBackfill` 已算好 `wouldAlertCount`，onboarding 用了，主卡没用）。
- ~~**②（中·交互）切 tab 页面弹到最顶**~~ **✅ 2026-07-29 已修并部署（swayfix4 run 4）**。**原来的根因判断是错的**——真凶不是 `ScrollReset`（它只是帮凶），而是**浏览器自己的夹紧**：切 tab 会把滚动容器 `#main-content` 的子树整棵换掉，那一瞬内容高度塌下去，浏览器把 `scrollTop` 夹成 0。CDP 逐帧采样坐实：**同一个 DOM 节点、全程没有任何 `scrollTo`/`scrollTop=`/`scrollIntoView` 调用**，一帧之内 900 → 0。所以修了三层才对：(a) 新增 `src/lib/scroll-reset-policy.ts` 的 `shouldResetScroll`——切 tab 不主动复位，换页/换实体页照旧复位（参数顺序无关，且 tab 切换常顺带丢掉 `page`，判据只看 tab 变没变）；(b) tab `<Link>` 加 `scroll={false}` 关掉 Next 自己那份；(c) **关键**：`ScrollReset` 在 `pointerdown`/`keydown` 时快照位置（那会儿旧内容还在），新内容落地后用 rAF 在 1.5s 内把位置还回去（`clampScrollTarget` 保证不超出新内容高度），用户一动滚轮/触摸/按键就立刻收手。**真浏览器实测（公网 URL + 真实鼠标事件）**：切 tab 1232 → **1232**（原地不动）、切回来 1232 → **1232**；回归：换页 4239 → **0**、换实体页 900 → **0**。原始（错误的）定位留档如下 —— 是 `ScrollReset` 全局复位，不是 Link 的 `scroll` 属性。`entity/[id]/page.tsx:220` 的 tab 是 `<Link href={?tab=x}>`（无 `scroll={false}`），但**光加 `scroll={false}` 修不掉**：`_components/scroll-reset.tsx` 监听 `searchParams` 变化就把 `#main-content` 滚回 0，`?tab=` 和 `?page=` 一视同仁。它是为「换页从头看」有意加的（外壳固定后 window 滚动复位失效）。修法：区分 `page` 与 `tab` —— 换页仍复位，切 tab 滚到**tab 条**位置（或不动），别把用户甩回页首。
- ~~**③（高·数据模型）关系 tab 大面积空**~~ **✅ 2026-07-29 已修并部署（swayfix4 run 2）**：新增纯逻辑模块 `src/lib/ecosystem-scope.ts`（`identityIds` / `dedupeSectors` / `selectPeersFrom`），`entity.ts:ecosystem` 改三处：① 先查 `ISSUES` 拼出「我的全部身份」（公司 ↔ 它发行的股票），取板块用 `fromId: { in: identity }`；② 板块成分放开为 `type in [COMPANY, STOCK]`（成分本来就几乎全是 STOCK）；③ 成分按发行公司归并、孪生只留一份（优先 COMPANY，与搜索归一一致），排除自己时排除**全部身份**。**同一批均匀抽样 60 个的前后对照**：COMPANY 完整 **1/60 → 59/60**、STOCK 完整 **7/60 → 59/60**（剩下那 1 个是无行业分类的死壳，属另一条 backlog）。线上实测东山精密公司页/股票页竞品**一致**且是真同行（生益科技/深南电路/胜宏科技/沪电股份/鹏鼎控股…），SECTOR 页仍正确无「行业与竞品」块（不回归 run 61 那个板块行情 bug）。**注**：本轮只解决「挂载端错位」，`RelationType.RELATED` 全库仍只有 1 条，产业链/上下游/竞对真关系源仍待补（另立条目）。原始定位留档如下 —— **COMPANY / STOCK 挂载端错位**。`entity.ts:123` 的 `ecosystem` 查 `fromId=当前实体 & BELONGS_TO & to.type=SECTOR`，而库里 `BELONGS_TO` 的组合是 **`STOCK→SECTOR` 5356 条 vs `COMPANY→SECTOR` 仅 181 条**：**COMPANY 有行业关系的只有 130/5498 = 2.4%，STOCK 是 5356/5500 = 97.4%**。所以进公司页→`sectors=[]`→直接 `return {peers:[]}`→整块空。且第二段查同侪又限定 `from.type=COMPANY`，就算板块取到了，同侪池也只有那 181 条里的——双重错位。（同型病：`Thesis` 挂 COMPANY 而 `EntitySignal` 挂 STOCK，见 lessons「类型声明不是事实」。）另注：`RelationType.RELATED` **全库 1 条** —— 产业链/上下游/竞对这类真关系压根没采，现在的「关系」只有骨架（发行 5500 + 归属 5537）。修法：(a) ecosystem 查询对 COMPANY 走「其发行 STOCK 的 BELONGS_TO」兜一层（页面已有 `relatedTicker` 同款做法，成本低）；(b) 中期补 RELATED 关系源。
- ~~**④（高·呈现）宁德时代半年报没抓到**~~ **✅ 2026-07-29 已修并部署（swayfix4 run 1）**：三处一起动——(a) `HEADLINE_TITLE` 补 `年度报告|季度报告|年报|中报|季报`，定期报告从「中性档」升为实质事件；(b) `pickRepresentative` → `pickRepresentatives`，同日**实质事件有几件留几条**（上限 `MAX_REPRESENTATIVES=2`），一件都没有时仍只留 1 条（不回退成刷屏），`burstCount` 记在最后一条代表下；摘要降为中性档、不占正文的代表位；(c) `EVENT_WEIGHTS` 新增 `半年度报告/季度报告/年度报告 = 30` → 一手定期报告 importance **45 → 75**（过重磅线 55，排在业绩快报 80 之下：快报是结果首次披露、增量更大）。新脚本 `src/scripts/rescore-periodic-filings.ts`（只碰 PRIMARY、只升不降、有界分片幂等）把库里 **35367 篇**存量定期报告补分完毕，剩余 0。**线上实测**：300750 公告 tab 现在**半年报与回购两条同时露面**+「同日另有 10 份」（12−2），COMPANY/STOCK 两个页面一致；大事记也首次出现《2026年半年度报告》。原始定位留档如下 —— 其实**采到了**，是被同日公告折叠吃掉了。`300750` 在 **2026-07-24 11:28 一次性 12 条 PRIMARY 公告**，其中 `宁德时代:2026年半年度报告`、`…半年度报告摘要` 都在库里。但 `collapseAnnouncementBursts`（threshold=4）把当日 12 条折成 1 条代表，`pickRepresentative` 先按标题分级：`HEADLINE_TITLE` 命中「回购」→ 回购公告 rank 0（importance 70）胜出，**「半年度报告」既不在 HEADLINE 也不在 PROCEDURAL，rank 1**，于是被折进「当日另有 11 份」里、标题完全不露面。叠加打分问题：`2026年半年度报告` importance **45**，跟《总经理工作细则》《董秘工作细则》同分——一年最重磅的一手文件被当程序性文档。修法：(a) `HEADLINE_TITLE` 补 `年度报告|半年度报告|季度报告|年报|业绩报告`；(b) 折叠代表允许多选（财报 + 回购这种同日双重磅，1 条代表不够）；(c) 提高定期报告的 importance 基线。**注意别误判成「没抓到」——采集是好的，坏在呈现层。**

来自扩容/部署几轮的已知项：
- **（中·ops）seed-universe 不是常驻 cron → 新股/复牌股会累积成覆盖缺口**（run 21 发现）：最新入库 STOCK 停在 7-25 扩容那批，seed-universe 之后没再跑。run 21 对当前可交易全集(push2delay 5883)diff DB(5492) 发现 422 缺失——415 是 ST/*ST（isSeedableStock 按设计拒，非缺口），**7 只正常股确实漏了**（白云机场/上海家化/氯碱化工/海欣股份/锦江在线/信雅达/腾龙股份，已 run 21 用 add-stocks 补上→5499）。但只要 seed 不定期跑，新 IPO + 复牌/改名股会继续累积。durable fix：把 seed-universe（+isSeedableStock 过滤）挂成 dashboard cron 定期跑，或每轮 d 顺手 diff 补。需 sway 定（同 brief-cron，带轻微 ingest 负载）。**run 30 更新：距 run 21 约半天，反向 diff 正常漏股 = 0（没再累积），说明累积速率很低（新 IPO 稀疏）→ 本条降级为低优先；「每轮 d 顺手 diff 补」这个兜底已足够（loop 本身就在做），dashboard cron 可选。**
- ~~**（需 sway 决策·ops）brief-recent cron 已确认停了**~~ **✅ 2026-07-28 已执行（sway 授权批量清 backlog）**：注册 durable hermit cron（id `cms4dxdbm0fwvpvzcxhi62c4f`，每日 ±90m，跑 `brief-recent.ts --limit=60 --hours=30`）——durable=跨重启存活（原 session-scoped 死因）。注册前实跑一次确认命令健康：**本轮生成 0 条**（当前无积压，池已排空，故此 cron 现为「有活即干/无活廉价空跑」的保险）。原始记录留档如下：run 20 用池增长趋势确证——候选池（近24h·重磅·属 thesis 公司·尚无 brief）**run 11=3 → run 15=1 → run 20=10 → run 24=17**（清后仍持续涨），说明该独立 cron（不在 ingest 主循环）**确定没在跑**。已第 2 次手动 `brief-recent.ts` 清空（run 11: 3/3、run 20: 10/10，AI 路径每次都证健康）；run 24 见 17 未再清（band-aid 不可持续，等 sway 决策）。但手动清是 band-aid、不可持续（loop 不该替死 cron 擦屁股）。**durable fix 需 sway**：在 dashboard 重新登记 brief-recent cron（session-scoped cron 重启即死，很可能是这样没的）。命令：`secret exec OPENROUTER_API_KEY -- env DATABASE_URL=... SKIP_ENV_VALIDATION=1 OPENROUTER_MODEL="deepseek/deepseek-chat" npx tsx src/scripts/brief-recent.ts --limit=40 --hours=24`（建议每日 1-2 次，有 AI 成本）。要我用 cron skill 帮登记就说一声——该 loop agent 不擅自建带成本的它源 cron。（另一条路：把 brief-gen 并进 ingest 主循环，但 ingest cron 当前不注入 OPENROUTER_API_KEY，需先改 ingest 启动命令注密钥，也是 ops 改动。）
- ~~**（中·产品价值待定）大事记「一年脉络」对热门板块只覆盖最近~1个月**~~ **✅ 2026-07-28 已执行（sway 授权）**：milestones 改按 `[{importance:desc},{publishedAt:desc}]` 取「全年最重磅 200」（而非最近 200），取到后再按 publishedAt 倒序喂 groupByMonth（保月内时序）。TDD（entity.test 新增 + 既有测更新）+ 已部署验证：**医药板块 milestone 从「覆盖 1 个月」→「覆盖 13 个月」（2025年7月→2026年7月整年跨度）**。原始记录留档：milestones `take:200` 取最近 200 条，热门板块（医药 740 / 汽车 665 / 半导体 520 / 新能源 463 / 人工智能 420 / 券商 202 条重磅事件/年）的最近 200 条几乎全落在最近 1 个月 → 号称「过去一年的重磅事件」实际只看得到 1 个月。run 10 已把计数改诚实（tab 显真实总数 + 视图头「共 N 条 · 显示前 200」），但要真正实现"一年脉络"需换取数策略（按月各取 top-N / 分页 / 虚拟滚动）。中等工作量。**run 37 复核仍现存**：医药 tab「大事记 740」、caption「共 740 条 · 覆盖 1 个月 · 显示前 200」、只渲染 1 个 details 块；直查那 200 条 publishedAt 全落在 2026-07-06..28（单月 22 天），整年最旧回溯至 2025-07-31——已诊断为 take:200-by-recency 取数把「一年脉络」坍缩成「本月」（groupByMonth 分桶正确、非机械 bug）。计数/caption 诚实，缺的是取数策略。**推荐修法**（等 sway 定）：milestones 在 total>200 时改按 importance desc 取（或每月 top-K），让 200 条跨越 12 个月；或对 SECTOR 干脆不显此 tab（板块级"大事记"本是聚合 firehose、语义弱）。
- ~~**（很低优先·健壮性，run 14）daily-digest 早报副标题硬编码「近 24 小时」**~~ **✅ run 41 解决**：不止 cosmetic——副标同时罩着 48h 的自选股段(personalDigest)，硬编码「24」对该段是真错标。已抽 `PERSONAL_DIGEST_WINDOW_HOURS=48` + `digestWindowHours(hasPersonal)` 单一来源，副标改 `近 {digestWindowHours(p.length>0)} 小时`（有自选股→48、仅市场→24），news.ts:120 也用同常量。TDD 6/6 + 已部署验证。
- ~~**（低优先·交互）PortfolioChanged 静音股名不可点**~~ **✅ run 18 已修**：「今日无异动 · N 支已静音：A、B、C」的股名改成 HoverPrefetchLink→`/entity/{id}`（与 review 页一致），TDD render 测护。
- **（低优先·显示）/feed 资讯流 take:50 无分页/加载更多**（run 19 发现）：feed.ts `orderBy [importance desc, publishedAt desc] take:50`，在 `surfacingSince` 时间窗内取前 50，无 Pager/加载更多/共 N。**无假计数**（不宣称总数），且目标用户自选 3–10 只、窗内 50 条通常够，故低优先。另 masthead「你自选股的最新动态」措辞偏「最新」而实际按重要性优先排（元数据已诚实写「按重要性与时间排序」）——要不要 masthead 改「重要动态」或 feed 加加载更多＝产品决策。
- ~~**研报/个股媒体只刷「冷尾」、热门股新数据漏采**（run 7 发现，需产品决策）~~ **✅ 2026-07-28 已执行（sway 授权）**：新增 `hotStockTargets(db,k)`（近 7 天资讯最多的 top-K 股，热度=STOCK+发行 COMPANY 近期资讯数合计），report-refresh(+hot10) 与 media-refresh(+hot12) 各在冷尾之外并入热门股（去重、热门优先）。TDD（backfill-targets.test 2/2）+ 功能级实跑验证：hotStockTargets 返回 东方财富/宁德时代/长鑫/机器人 等真热门股，研报刷新 **inserted=4 条新研报**（冷尾永不选中的股）。ingest-only、下个 ingest 周期自动生效。原始记录留档：`report-refresh` 与 `media-refresh` 都用 `targetsByNeed`（绑定最少优先）→ 每轮只刷绑定最少的 12/20 只冷门股；热门/活跃股（茅台等）绑定多→永远不会被选中→**它们每天新出的研报 / 个股媒体资讯从不被这两个刷新器采集**。证据：直探 report API 活着，茅台有 07-23 中邮证券 / 07-20 群益证券研报，但库内最新研报 `publishedAt≈100h 前`(~07-22)、eastmoney-stocknews 最新 createdAt 38.6h 前。注：热门股的**一手**数据（公告/快讯/龙虎榜等全局源）仍新鲜，缺的只是 MEDIA 级研报/媒体深度。修法（需 sway 定）：给 report/media-refresh 增设「近期活跃/高热股」轮扫或按热度分层刷新，权衡 API 预算；研报为二手补充、非核心，优先级待定。**run 42 复核（恶化）**：按天聚簇确认个股资讯+券商研报**自 2026-07-25 起 3 天零写入**（73-75h flat）；ingest.ts:74/90 确认两 refresh 仍每轮调用（ingest 活着），但 targetsByNeed 只挑冷尾→冷股 0 插入、热门股新研报永不采。症状=热门股「研报/个股资讯」tab 冻结 3 天，比 run7 更明显。
- **美股无行情/K线（真数据缺口，非边缘态）**：`tickerToSymbol`/`tickerToSecid` 只认 6 位 A 股码；美股页现只有新闻没价格。run 8 已把 A股专属 UI（行情卡/到价提醒/A股披露日历）对美股优雅隐藏（`isAShareTicker` 门控，不再有空骨架/无效提醒/错误的 A股财报截止日），但**美股本身的实时行情/K线仍需接入行情源**（新浪 `gb_<sym>` 或东财 US secid）+ 页面接入。中等工作量，待 sway 定是否做。
- **催化临近语义**：现为「下 2 个财报截止节点」（固定日历，非自选股相关）。要不要改成真·「两周内」动态信号（平时 0、临近才亮）？产品决策，待 sway 定。
- **media-refresh 排序**：ingest 的 media-refresh 用 `targetsByNeed`（按总新闻数），补不到「总量够但媒体缺」的股。彻底修需按 media 缺口单独排序。
- **~75 只无媒体股**：个股资讯搜不到，是冷门/次新的内在下限（有公告不空页）。可考虑别的媒体源补。
- **回购 / 股权质押 端点名待查**：东财数据中心报表名未撞对（run7 数据源调研）；接入后可加两类事件/信号。
- **发现页 listByType 拉全量**：`entity.listByType` 无上限，发现页为显示 90 个+计数拉全部 ~10k 实体/次。实测发现页 130ms（当前不慢，未成用户可感回归），但可优化为 count()+take。低优先。
- **死实体在 STOCK 池（run 12 refine，原「61 退市」低估了）**：完全空白 85 家 = 退市/ST 名 43 + **正常名的历史/更名/换股/合并** 42（中国北车→中车、海通证券→国泰海通、东方明珠 600832 老码、上实医药→上药、上药转换换股名、PT水仙/S*ST 股改期名…）。isSeedableStock 已拒**退市/ST 名**防新增，但**正常名的历史死码抓不到**（名字看着正常、只是那个代码早不交易了）。都计入「5492 只 A股」+ 可能出现在发现页浏览、点进是空页。**可靠清理只能靠对当前可交易 A股清单(push2delay seed 源返回的实时列表)做交叉核对**：ticker 不在实时列表 → 判死 → 从计数/展示排除(或软删)。**产品决策待定：排除 vs 删实体保历史**；名字模式不可靠(会漏 42 个历史死码)。**SEO 连带(run 13)**：sitemap 收录全部 11124 实体(含这 85 个死壳)，爬虫被指向 ~85 个薄/空页(200 但无内容、非 noindex 因实体存在)。清理死实体时应一并从 sitemap 排除(或简单点：sitemap 只收「有 ≥1 条资讯」的实体，安全、不删数据、不需实时清单交叉核对——可独立小修)。**run 39 数据**：换个角度量「未分类 STOCK(0 条 BELONGS_TO)」=144(沪107/深32/北交老3/北交920 2)，样本大量是「退市X」死壳(退市泽达/观典/紫晶/太和/中新/博天…)——与本条死实体同源；真·未分类的活股只是尾巴(珈凯生物等少数北交所)。分类补齐走 seed-industries(全量 reseed)，死壳清理仍等 exclude-vs-delete 决策。**run 50 显现**：旗舰覆盖 claim「已覆盖全部 5500 只 A股（+美股）」的 5500=count(STOCK,ticker≠null)=5469 A码+31 美股,其中 77 是 ST/退/死壳——即死壳虚高了「N 只 A股」~108（真实可交易 A股 ~5392）。死壳排除出计数就绑本条 exclude-vs-delete 决策（且需实时全集交叉核对、无法 per-request 剔除）。**✅ 2026-07-28 sitemap 部分已执行（sway 授权）**：sitemap 改为 `where: { news: { some: {} } }` 只收有 ≥1 条资讯的实体——死壳/0资讯薄页不再进 sitemap（爬虫不再被指向空页）。TDD（sitemap.test 2/2）+ 已部署验证：/entity/ URL 从 ~11124→**10893**（排除 ~231 个 0 资讯实体），翰博高新(0新闻)已排除、珈凯生物(有新闻)保留。**实体本身按推荐保留不删**（保历史，只从 sitemap 排除）；剩「计数/发现页是否也排除死壳」仍可后续（低优先）。
- **北交所未分类（run 12：333→4，基本已解决）**：run 4 时 333 只北交所无行业分类，现仅剩 **4 只**未分类（seed-industries 已覆盖绝大多数北交所）。剩 4 只可下一轮顺带补，或忽略。原「是否覆盖北交所」产品问题已事实上按「覆盖」落地。
- **86 只 0 新闻 / 281 只 0 媒体**：多为冷门/次新，个股资讯搜不到，是市场客观下限(有公告不空页)，非可修 bug。
- **房地产 空板块**：主题板块 0 成员(房企归在「房地产开发/服务」行业)，已被 allSectors(memberCount>0) 过滤不显示；可删该 dead 主题实体。
- **（中·产品决策，run 46 lead→run 48 确认）theme-vs-行业 sector 分类重叠 → 显著 theme sector 欠填充**：141 个 SECTOR 里，行业子板块填得满（化学制药149/医疗器械134/半导体212/汽车零部件265/通用设备246…），但**高层 theme sector 稀疏**——典型「医药」theme 只 **12** 成员，而 pharma 其实全覆盖、分散在 化学制药149/医疗器械134/中药61/生物制品56/医疗服务53/医药商业29 等行业子板块。用户在 discover/首页看「医药 12 只」显著展示，**会误以为 pharma 覆盖差**（实则齐全、在子板块）。非覆盖缺口（股都在库、都可搜），是**分类模型**问题。近空的还有 旅游零售2/医疗美容3/林业3/体育3/农业综合3/其他家电3 等（部分窄行业正常、部分 theme 重叠）。**需 sway 定 sector 模型**：① theme sector 聚合其子行业成员（医药=化学制药∪医疗器械∪…）；或 ② 隐藏/降权成员数过少且有行业替代的 theme sector；或 ③ 删冗余 theme sector（注意 thesis/hot-universe 可能引用）。我倾向 ②（最小改动：allSectors 已按 memberCount>0 过滤，可加一档「有行业替代时隐藏 <N 成员的 theme」），但需你拍板取哪条。
- **notFound() 在 force-dynamic 页返 200 不是 404**：`/entity/坏id`、`/news/坏id` 渲染正确的未找到页但 HTTP 200（`/totally-bogus` 路由正确 404，故是 force-dynamic+流式下 notFound() 状态码失效，非路由问题）。影响低：用户看到正确未找到页 + entity/news 的 generateMetadata 对缺失已设 `robots:{index:false}`(noindex)→SEO 兜住；无 bogus 内链。修复框架级 nuanced(动 force-dynamic/流式有风险、且与实体页「Promise.all 不加串行 await」的性能重构冲突)——待定。
- **hotSectors() 查询已弃用未删**：首页/发现页已切 allSectors；hotSectors 保留向后兼容，确认无引用后可清理。
- **（备注·非 bug，run 42）JWTSessionError「no matching decryption secret」是预期噪声**：start-prod.sh（2026-07-28 被另一 session 改）改为注入 secret store 的强 AUTH_SECRET（取代 .env 弱值），run 41 部署首次激活 → run41 前签发的旧会话 cookie 一律解不开，日志刷该错。**已 run 42 功能级验证新会话正常**（当前密钥铸 cookie→/review 200 认证态）。旧用户重登一次即恢复；日志噪声待旧 cookie 过期自然消退。**下次见此错别当 bug 排查**（除非新登录也失败=另一回事）。

---

## 逐轮记录

<!-- 每轮追加：
### Run N — YYYY-MM-DD HH:MM · 维度 <x>
- 发现：<问题 + 证据(HTTP/DOM/DB/日志)>
- 修复：<改了什么，commit 级；或「本轮只查+记录」>
- backlog 新增：<若有>
- 部署：<是否 build+start-prod.sh，验证结果；或「无需上线改动」>
- 自测：<tsc/vitest/复现，结果>
- 下轮维度：<下一个>
-->

### Run 1 — 2026-07-26 12:43 · 维度 a 交互性/可点性
- 系统扫查：底部导航(今日/机会/自选/组合)、通知铃铛→/notifications、实体引用(workbench 变化项/portfolio-impact/portfolio-changed/hot-sector 板块+成员)、新闻卡(原文+/news/id)——**均已是 Link，链接性总体良好**；催化临近上轮已修。
- 市场指数条(恒生/道琼斯…)纯 span 不可点，但**无指数详情页**→不该点，非问题；news-scorecard 统计无链接→是指标非导航目标，可不点。
- **发现+修复**：工作台「当前投资卡」股票名(`workbench-rail.tsx:52`)是纯 `<p>` 文本、不可点——移动端用户点的是卡片主体那个大股名，而非小小的「打开工作台→」链接。改成 Link→/entity/{id}（与全站实体名一致、移动端可 tap）。
- 部署：build exit0 → start-prod.sh(pid 16280) → 首页200 + CSS哈希 fe35173f63742fc5=200 + AI ping OpenRouter=200 + [boot]密钥齐全。
- 自测：tsc 34(无新增) + vitest 580 全绿 + 上述部署验证。
- 下轮维度：b（显示 vs 全量/最新数据）

### Run 2 — 2026-07-26 22:58 · 维度 b 显示 vs 全量/最新数据
- 核查：实体页「资讯N/公告N」=真 `count()`✓；板块成员 getById 无上限✓；发现页分类计数 listByType 无上限=真实全量✓；全部覆盖 5495只/140行业 渲染正确✓；「共N/显示前M」诚实模式已用✓。显示层总体反映全量。
- **发现+修复**：allSectors 板块「N只」把同公司的 STOCK(行业分类)+COMPANY(主题分类)**双算**——证据：半导体 212=193 STOCK+19 COMPANY(16 重叠)、银行 52=42+10(10 全重叠)。抽 `dedupeSectorMembers`(按公司名去重、STOCK 优先、热度相加) + 接进 allSectors。半导体 212→**196**、银行 52→**42**、人工智能 23→23(本就无重复)。线上 HTML 实测半导体已显 196。
- backlog 新增：发现页 listByType 拉全量 ~10k 行只为显示 90（当前 130ms 不慢，低优先优化）。
- 部署：build exit0 → start-prod.sh(pid 21473) → 首页200 + CSS f06924950b56aa3b=200 + AI ping 200 + [boot]密钥齐全 + 半导体 196 只实测渲染。
- 自测：tsc 34(无新增) + vitest 582 全绿(新增 dedupe 2 测) + 部署验证。
- 下轮维度：c（静默故障）

### Run 3 — 2026-07-27 00:43 · 维度 c 静默故障
- 全面体检，**无静默故障**：① 线上日志无 error/unhandled；② ingest 在跑（快讯 6h 内 43 条），实跑一轮**零 FAILED**——9 源 fetch 正常 + enrich(6)/price-alert/signals(consensus1996)/sector-signals 全跑通无吞错；③ AI 功能真活：NewsItem.brief 最新 9.4h（brief 走 OpenRouter）；④ 请求态外部源无静默失败：直测 fetchQuote=中芯143.73、fetchValuation PE243.87(push2 死但腾讯兜底真活)，个股页实测渲染行情+估值卡。
- **排除的假象**（都带证据）：billboard/blocktrade/exechold 36h 未更新=**今天周日、周末无新市场数据**（非故障）；Interpretation 322h/13天=**按需 mutation(getOrCreate 有缓存返缓存/否则生成)、无 cron、13 天没人触发新解读**（非故障，AI 路径由 brief 证健康）。
- 未测：邮件 OTP 发送（keys 齐、boot 自检✓，但功能测会真发邮件，未触发）。
- 修复：**本轮无**（无静默故障可修）。部署：**无**（无代码改动，不重启生产）。
- 自测：健康结论逐条带证据复核（日志/ingest 实跑/brief 时间/行情估值直测）。
- 下轮维度：d（覆盖缺口）

### Run 4 — 2026-07-27 00:43 · 维度 d 覆盖缺口
- 缺口全貌：STOCK 5495 → 0新闻86 / 0媒体281 / 未分类板块139 / 孤儿0 / 空板块1(房地产)。
- **数据质量 bug + 修复**：未分类样本暴露「假股票」——`isSeedableStock` 两个漏洞：①不拒可转债(定转/转债)→3 只 810xxx 债券混入；②只判尾字「退」拒不掉前缀「退市」→61 只退市股(退市泽达等)漏过。TDD 修(拒 定转/转债 + 含「退市」)+ 清掉 3 只明显污染的可转债(STOCK+COMPANY 各3,级联3新闻)。STOCK 5495→5492。
- backlog 新增：61 退市存量(删vs排除待定)、333 北交所未分类(产品决策)、86/281 零新闻媒体(内在下限)、房地产 dead 主题。
- 部署：build exit0 → start-prod.sh(pid 70783) → 首页200 + CSS200 + AI ping 200 + 密钥齐全 + 可转债残留0 实测。
- 自测：universe 15 测绿(新增退市前缀+可转债 2 测) + tsc 34 + vitest 584 全绿 + 部署验证。
- 下轮维度：e（坏链/404/500）

### Run 5 — 2026-07-27 01:43 · 维度 e 坏链/404/500
- 系统扫查全 200：主路由(/ /discover /login /sitemap /robots /notifications /profile /review /plus /feed /settings /onboarding /discover?type=…) 全 200；各类型实体页(STOCK/COMPANY/SECTOR/PERSON) + 边缘(美股英伟达/退市泽达/北交所920045/中概板块) 全 200；新闻页 200；抽 8 行业板块 + 5 新股(带 retry)全 200；bogus 路由 /totally-bogus 正确 404。（sweep 中一次 000 是瞬时超时，retry 后 200，非真坏链。）
- **发现(记 backlog,非本轮修)**：`/entity/坏id`、`/news/坏id` 返 HTTP 200 而非 404——force-dynamic+流式下 notFound() 状态码失效(entity:153/news:69 都调了 notFound、渲染出「未找到/404」页内容，但状态 200)。低影响(用户看到正确页+缺失已 noindex)、修复框架级 nuanced。
- 部署：**无**(无代码改动)。
- 自测：复现确认——坏 id 页渲染未找到页体+状态 200(响应头实测)、真实页全 200、bogus 路由 404；noindex 已在 generateMetadata 确认。
- 下轮维度：f（文案准确性）

### Run 7 — 2026-07-27 04:43 · 维度 g 数据新鲜度
- 方法：写 scratchpad tsx 按 `createdAt` 时间聚簇逐源核（不看行数，遵 lessons「吞吐量≠新鲜度」）。**今天周一 04:00 CST，上个交易日=周五 07-24**。
- **管线健康且新鲜**（证据）：kuaixun 最新 createdAt 0.3h 前 / eastmoney-announcement 7.3h / wallstreetcn 7.3h；全库 createdAt 每天都有写入（含今天）；时间戳真实性：publishedAt≈createdAt 的退化比例仅 1-9%（kuaixun/wallstreetcn/jiwei 的实时新闻本就发布≈抓取），非退化成抓取时间。
- **周末正常冻结（非 bug，已验证）**：billboard/blocktrade/exechold(龙虎榜/大宗/董监高) ~40h、cninfo-announcement 37h——全是交易日市场数据源，最新=周五数据，周一盘前 0/24h 属正常，下次更新在周一收盘后。
- **发现+修复（安全 TDD）**：`eastmoney-forecast` 业绩预告 `publishedAt` 落在**未来**——源只给日期，代码按 `T08:00:00+08:00`(市场开盘约定)打戳；今天披露的预告在 08:00 前被抓到时戳落未来（凌晨 00:00-08:00 每天复现，会乱序 + 显示「N 小时后发布」）。TDD 修：`forecastToRawItem` 加可注入 `now` 参 + 钳位 `stamped>now?now:stamped`（过去日期仍保 08:00 约定）。**实测反证**：直探 datacenter API 拉 500 行，旧逻辑本时段会产 3 条未来戳、修后 0 条。
- **发现（记 backlog，需产品决策，未修）**：研报/个股媒体只刷冷尾、热门股新研报/媒体漏采（report-refresh+media-refresh 都用 targetsByNeed 绑定最少优先）——证据：report API 活着有茅台 07-23 研报，库内最新研报 100h 前。详见上方 backlog。
- 部署：**无需 Next build/重启**——forecast 源仅被 tsx ingest 脚本 import、不在 Next app bundle；ingest 走 `npx tsx src/scripts/ingest.ts`(源码非构建，dashboard cron 调度，日志 04:05 刚写)，下轮 cron 自动生效。按 lessons「无需上线改动别 build」不动生产 Next。
- 自测：tsc 34(无新增) + vitest 88 文件 **586** 全绿(新增 forecast clamp 2 测) + 上述 live API 反证(旧 3→修 0 未来戳)。
- 下轮维度：h（空状态/边缘）

### Run 8 — 2026-07-27 05:43 · 维度 h 空状态/边缘
- 方法：scratchpad tsx 找各类边缘实体(美股/退市/0新闻/北交所/最少关系 PERSON) → curl 逐页看渲染。
- 边缘扫查结论：退市泽达(688555)/北交所翰博高新(833994,0新闻)/PERSON赵海军 页面均 200 且体面——0新闻股正确显「暂无相关资讯」、退市股仍有行情、PERSON 页正常。**问题集中在美股(31 只)**。
- **发现（3 个同源边缘态，证据）**：美股 ticker 是字母(NVDA 等)，`tickerToSymbol`/`tickerToSecid` 只认 6 位数字→全返 null。导致美股实体页：① 行情卡 `fetchQuote` 即时返 null→QuoteCard 返 null，但页面仍挂 `<Suspense>`→**骨架闪一下再消失的幽灵态**(实测 NVDA `text-3xl font-bold`=0 无价格；因 null 是同步返回、闪现极短)；② **催化日历显示 A股法定披露截止日**(年报4/30、半年报8/31…)——对英伟达完全不适用、误导(curl 实测 NVDA 渲染出「催化日历」标题+「A 股法定披露截止日」footer)；③ 到价提醒卡对美股照挂，但价格取不到→**永不触发**。
- **修复（安全 TDD）**：`lib/quote.ts` 加纯函数 `isAShareTicker(ticker)`(= `tickerToSecid!==null`，含 null 兜底；北交所 8 开头也算 A股)+ 单测 2 例(A股/北交所 true；美股/港股/空/null false)。`entity/[id]/page.tsx` 用 `quotable=isAShareTicker(quoteTicker)` 门控**三处 A股专属 UI**：行情卡、到价提醒、催化日历的 A股披露节点(`nodes={quotable?…:[]}`)；并把 catalystBlock 收紧为「有节点或有 thesis 催化」才渲染(免美股留空 div 空隙)。美股页从此只剩它真正有的内容(资讯/关系/记分卡/thesis)。
- backlog 更新：美股行情源接入仍是真数据缺口(本轮只把空态做体面，未加美股行情)——见上方 backlog。
- 部署：build exit0 → start-prod.sh(pid 85739) → 首页200 + CSS f06924950b56aa3b=200(哈希匹配当前 HTML) + AI ping OpenRouter /models=200 + [boot]密钥齐全。**live 实测**：NVDA「A股披露日历」0 残留(标题+footer 皆 0)、页仍 200+资讯 52 条链接在；北交所翰博高新「A股披露日历」仍在(2)+行情价仍渲染(2)——证明 A股 UI 未误伤。
- 自测：tsc 34(无新增) + vitest 88 文件 **588** 全绿(新增 isAShareTicker 2 测) + 上述部署+live 双向验证。
- 下轮维度：a（交互性/可点性）——八维一轮走完，进第 2 轮循环。

### Run 9 — 2026-07-27 06:43 · 维度 a 交互性/可点性（第 2 轮）
- 系统复扫（run 1 已查 nav/铃铛/新闻卡/实体引用）：本轮遍查数据展示组件——NewsScorecard/SignalStrip(纯指标无导航目标,合理不可点)、EcosystemCoverage(板块/竞品/新闻全 Link)、EventTimeline(信号→/news 已链)、ThesisAlerts(实体+新闻已链)、通知页(到价→实体、资讯→NewsCard 已链)、新闻详情页(实体/相关/原文全链)、PortfolioImpact(全链)、WorkbenchRail(全链)、MorningBriefing(3/4 卡可点,今日静音无 drill 目标合理)。整体可点性成熟。
- **发现（高价值 gap，证据）**：**投资逻辑卡（thesis-card + my-thesis-card）「近期触及逻辑的动态」列表的触发新闻标题是纯文本、点不进原文**（`thesis-card.tsx:93`、`my-thesis-card.tsx:177` 都是 `<p>{s.newsTitle}</p>`）——而同样的触发新闻标题在 EventTimeline / ThesisAlerts 里都是 `/news/{id}` 链接。用户在核心组件上看到「是哪条消息动了逻辑」却点不进去，正是「催化临近」那类交互缺口。数据层其实**已带 newsId**（`entity.thesisSignals` 查询已 select、且 `ThesisSignal.newsId` 是非空 FK→**每条信号都能链**）、只是展示层没渲染成链接。
- **修复（安全 TDD）**：抽出共享服务端组件 `SignalLogItem`（`signal-log.tsx`）——一条监控日志，newsId 存在时标题渲染成 `/news/{id}` 链接（与时间线/异动口径一致），否则纯文本兜底。TDD 3 测(有 newsId→出链接；无→纯文本；显示维度/材料度)。ThesisCard 与 MyThesisCard 各自 `newsTitle` 段的重复内联 `<li>` 替换为 `<SignalLogItem>`、类型加 `newsId`（`personalizeSignals<T>` 泛型保型、newsId 自动透传）。去重顺带消掉两处口径漂移风险。
- backlog 新增：PortfolioChanged 静音股名不可点（低优先，见上方 backlog）。
- 部署：build exit0 → start-prod.sh(pid 31077) → 首页200 + CSS f06924950b56aa3b=200(哈希匹配当前 HTML) + AI ping OpenRouter /models=200 + 密钥齐全。**live 实测**：北方华创(有 thesis+信号)页 thesis 卡「近期触及逻辑的动态」的员工持股计划公告标题现渲染出 `href="/news/cmr341s97001eitcohgn7rbk1"`、整页 44 条 /news 链接。
- 自测：tsc 34(无新增) + vitest **89 文件 591** 全绿(新增 signal-log 3 测) + 上述部署+live 验证。
- 下轮维度：b（显示 vs 全量/最新数据，第 2 轮）

### Run 10 — 2026-07-27 07:43 · 维度 b 显示 vs 全量/最新数据（第 2 轮）
- 逐面核对 DB ground truth vs 显示：覆盖数「5492 只 A股 · 140 个行业」= DB 精确匹配（STOCK 有 ticker 5492、有成员 SECTOR 140）✓；discover 分类计数用真实 `listByType.length` + 诚实「前 90 / 共 N」✓；实体页 资讯/公告 tab = 真 count()（run 2 已验）✓；followerCount=watchlist.count()✓；radar=真 groupBy✓。整体显示保真度成熟。
- **发现（silent cap，证据）**：**大事记 tab 计数被 `take:200` 静默截断、却当全量显示**——`milestones` 查询 `take:200`，页面 tab 标 `大事记 ${items.length}`、视图头 `spanSummary` 也按已展示条数算「共 N 条」。实测 6 个热门板块超 200：医药 740 / 汽车 665 / 半导体 520 / 新能源 463 / 人工智能 420 / 券商 202。→ 医药板块页显「大事记 200 · 共 200 条」，实际库里 740 条。
- **修复（安全 TDD）**：`milestones` 查询改返 `{ items(capped 200), total(真实 count) }`（同一 where、count 不受 take 限制）。`spanSummary(months, total?)` 加可选真实总数：total>已展示时输出「共 {total} 条 · 覆盖 M 个月 · 显示前 {shown}」，不传 total 时向后兼容（旧 2 测不动）。page.tsx tab 标签与视图头都用真实 total。TDD：spanSummary +2 测（触顶/未触顶），entity.test.ts milestones 2 测更新到新 `{items,total}` 契约并断言 count 用同一 importance 过滤。
- backlog 新增：大事记「一年脉络」对热门板块只覆盖最近~1月（take:200 取最近的、热门板块全落在近 1 月）——计数已诚实，深修需换取数策略（见上方 backlog，中等工作量）。
- 部署：build exit0 → start-prod.sh(pid 36920) → 首页200 + CSS f06924950b56aa3b=200(哈希匹配) + AI ping OpenRouter /models=200 + 密钥齐全。**live 实测**：医药板块页 `?tab=milestone` 现显「大事记 **740**」+ 视图头「共 **740** 条 · 覆盖 1 个月 · **显示前 200**」（修前是 200/共200）。
- 自测：tsc 34(无新增) + vitest **89 文件 593** 全绿(spanSummary +2、entity milestones 2 测更新) + 上述部署+live 验证。
- 下轮维度：c（静默故障，第 2 轮）

### Run 11 — 2026-07-27 08:43 · 维度 c 静默故障（第 2 轮）
- 全面体检，**核心无静默故障**：① prod 日志(pid 36920 起)零 error/exception，只有 `[boot]✓密钥齐全`；② ingest 日志**零 FAILED**——run 7 的 forecast 改动在生产跑得干净(fetched=212 无错)、9 源 + enrich/signals 全通(kuaixun inserted=29、announcement inserted=1，Monday 已开盘)；③ 静默 catch 审计：quote.ts/signals.ts/eastmoney-ann.ts 的 catch 都是有兜底或 per-item skip 的**正当**吞错(push2→腾讯、单只失败跳过)，daily-digest.tsx 的 `catch {}` 是 localStorage 访问守卫(正当)——无危险空 catch。
- **AI 功能级双重验证（不止 /models auth）**：直接 POST deepseek/deepseek-chat 完成一次 = HTTP 200 + 返回 content ✓；并跑真实产品路径 `brief-recent.ts`（generateEventBrief→server/ai→OpenRouter deepseek→DB）**3/3 成功**生成事件摘要 ✓。AI 层端到端健康，排除 7-24 式静默 AI 停摆。
- **发现+处理（小维护）**：AI 事件摘要(NewsItem.brief)最新曾停在 17.4h 前、3 条合格资讯积压——该摘要是**独立 cron**（不在 ingest 主循环），疑似最近未触发。已手动跑 brief-recent.ts 清掉积压(3→0，近24h brief 1→4)。**根因是调度不是代码**：记 backlog 请 sway 确认 brief-recent cron 仍在 dashboard 调度（见上方 backlog）。
- backlog 新增：brief-recent cron 调度确认（ops，需 sway）。
- 部署：**无**（无代码改动；仅跑数据维护脚本 brief-recent，非 build/重启）。
- 自测：只查+维护轮，逐条带证据复核——日志零错、deepseek 完成 200+content、brief 3/3、候选池 3→0 实测确认；无代码改动故不需 tsc/vitest/部署。
- 下轮维度：d（覆盖缺口，第 2 轮）

### Run 12 — 2026-07-27 09:43 · 维度 d 覆盖缺口（第 2 轮）
- 方法：跑产品自带 `coverage-report.ts`（只读巡检）+ scratchpad tsx 拆解空白/未分类/无码。
- **覆盖成熟**（证据）：COMPANY 5490 / STOCK 5492 / 资讯 648914；有任意资讯 5409/5490=98.5%、近30天 94.6%；有绑定代码 5488/5490=100%；thesis 热门宇宙 130/130=100%。近24h 入库 356、近7天 630812（ingest 活跃）。
- **北交所未分类 333→4（基本已解决）**：run 4 时 333 只北交所无行业，现仅剩 4 只未分类（seed-industries 已覆盖绝大多数）。
- **发现（refine backlog，非新 bug）**：完全空白 85 家不是「全是退市空壳」——拆解为 退市/ST 名 43 + **正常名的历史/更名/换股/合并死码 42**（中国北车→中车、海通证券→国泰海通、东方明珠 600832 老码、上实医药、上药转换换股名、PT水仙/S*ST 股改名…）。这些正常名的历史死码 isSeedableStock 抓不到（名字正常、只是代码早不交易），计入「5492 只」+ 发现页可点进空页。134 未分类中除 4 北交所外几乎全是这类死实体（有历史新闻但不再交易），**无一只是「活跃可交易却漏分类」的可修缺口**。
- **无安全机械修**：可靠清理死实体只能对「当前可交易 A股清单」(push2delay seed 源实时列表)做 ticker 交叉核对，名字模式不可靠（漏 42 个历史死码）；且「排除 vs 删」是产品决策——记 backlog（已 refine 原「61 退市」条）。2 家无码 COMPANY（华润新能/豪威集团）是未上市/子公司主题实体，正常。
- backlog 更新：死实体条 refine（85 死 = 43 退市 + 42 历史死码，需市场清单交叉核对）；北交所条标记基本解决。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：只查轮，逐条带证据复核——coverage-report 98.5%/81 空白、拆解 43+42、未分类 4 北交所+余为死实体、2 无码 COMPANY，均实测确认。
- 下轮维度：e（坏链/404/500，第 2 轮）

### Run 13 — 2026-07-27 10:43 · 维度 e 坏链/404/500（第 2 轮）
- 方法：主路由 + **internal 链接爬取验证**（run 5 没做的）+ sitemap 校验 + 4 次部署后回归。
- **全绿，无坏链**（证据）：① 主路由 16 条(/ /discover /login /notifications /profile /review /plus /feed /settings /onboarding /sitemap /robots + discover?type=各类) 全 200；② 从首页/发现/医药板块/北方华创 4 个种子页爬出 **590 条唯一 internal 链接(501 entity+75 news+14 其它)逐个 curl = 0 条非 200**——run 8/9/10 新增改动(catalyst 门控/signal-log /news 链接/milestone)产出的链接全有效；③ sitemap **16128 URL**(11124 entity + 5000 news + 4 静态)抽样(首末各 5 entity+news)全 200、news 均真文章无「未找到」死链；④ tab 变体(news/announce/milestone/relation + page2)、边缘实体(美股/退市/PERSON/医药 milestone)、tRPC(allSectors/news.digest)、深翻页(p50/越界 p9999)全 200 且优雅。
- **已知项(未变)**：`/entity/坏id`、`/news/坏id` 仍返 200 非 404(force-dynamic notFound 状态码失效，run 5 已记 backlog，低影响+noindex)。
- backlog 更新：死实体条加一句 SEO 连带——sitemap 收录全部 11124 实体含 ~85 死壳(薄页)，清理时一并排除；**可独立小修**：sitemap 只收「有 ≥1 资讯」的实体(安全、不删数据、不需实时清单交叉核对)。本轮未擅动(牵涉 SEO 爬取策略，留给 sway/下轮)。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：只查轮，全部 curl 证据实测复核（主路由/590 链接/sitemap 抽样/tab/边缘/tRPC/翻页均如实记录 HTTP 码）。
- 下轮维度：f（文案准确性，第 2 轮）

### Run 14 — 2026-07-27 11:43 · 维度 f 文案准确性（第 2 轮）
- 方法：全量 grep UI 时间窗/周期文案 → 逐个对后端 query 窗口；核对枚举→中文标签映射(eventType/tier/entityType) vs DB 真实取值；查「实时/第一时间」是否夸大。
- **文案准确，无 label≠行为**（证据、逐条对齐窗口）：daily-digest「近 24 小时」=`DIGEST_WINDOW_HOURS`(24)✓；portfolio-changed/briefing「近 7 天」=`portfolio.changed()` days 默认 7✓；scorecard「近 30 日」=query since 30d✓；radar/command-nav「近 3 天」=radar since 3d✓；hot-sector「近 7 天」=allSectors since 7d✓；milestone「过去一年」=months 12✓；催化临近「下两个财报披露截止节点」=upcomingDisclosureNodes(now,2)✓；briefing 三卡文案(需复核=weakened=偏风险 / 逻辑增强=strengthened=偏兑现 / 今日静音=unchanged)全对齐定义✓。无字面「两周/半月」类错窗。
- **枚举→标签映射健康**：NewsItem.eventType 32 种取值全是自描述中文(回购/减持/研报/龙虎榜…)，`eventTypeLabel` 用 `?? 原值` 兜底 + 仅 3 个需展开(处罚→监管处罚/问询→问询函/解禁→限售解禁)已映射→无 raw 泄漏；tier(PRIMARY→一手/MEDIA→媒体)、entityType 全覆盖。
- **「实时」核查**：thesis 卡「非实时，随重大变化再生成」是准确免责；仅首页 page.tsx:122「交易所公告…全市场实时含正文」是较松的营销措辞(ingest ~30min 周期，近实时非真实时)——轻微、非硬错，未动。
- backlog 新增：daily-digest:145「近 24 小时」硬编码未用常量（当前准确、可能漂移，很低优先，见上方 backlog）。
- 部署：**无**（无 label≠行为的当前错误可修；纯查+记录）。
- 自测：只查轮，逐条把 UI 文案与后端窗口/定义对齐复核，枚举映射对 DB 全取值核对，均实测确认。
- 下轮维度：g（数据新鲜度，第 2 轮）

### Run 15 — 2026-07-27 11:55 · 维度 g 数据新鲜度（第 2 轮）
- 方法：scratchpad tsx 逐源 createdAt 新鲜度 + 未来戳检查 + brief 池；读 ingest 日志。今天周一开盘日（午间）。
- **管线健康 + run7 修守住**（证据）：近24h 入库 487、**24/24 小时都有写入**（ingest 连续没停）；活跃源全新鲜——eastmoney-announcement/kuaixun/wallstreetcn 最新 createdAt 0.1h；**publishedAt 落未来的条数 = 0**（run7 forecast 钳位在生产守住）。
- **stale 源逐个解释、无真故障**：cninfo-announcement 45h（**已弃用**：ingest.ts:23「东财全市场公告带正文取代巨潮爬虫」，legacy 5715 条仍服务历史页、新公告走东财，零影响）；billboard/blocktrade/exechold 48.6h（盘后数据，周五的已入、周一的今晚收盘后才来，正常）；eastmoney-report 48h / stocknews 46.6h（冷尾轮换，run7 已 backlog）；jiwei-hbb 65h（集微=低量半导体媒体，fetched=10 inserted=0=近期没发新，周末+周一晨属正常）；forecast/shareholder 有近期入库。
- **瞬时外部错误（自愈，非静默）**：日志一次 `eastmoney-kuaixun FAILED: eastmoney 502`（全日志仅此 1 次），下一 cycle 即恢复（inserted=27/18/20）——被 catch 打日志、非静默吞，弹性正常。
- **brief**：候选池 1（小）、cron 大致跟得上；run11 的「确认 brief-recent cron 调度」backlog 仍挂着、但不紧急。
- backlog 新增：无（cninfo 弃用属设计、kuaixun 502 瞬时自愈、jiwei 低量、冷尾/brief-cron 已在 backlog）。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：只查轮，逐源新鲜度 + 0 未来戳 + 24/24 小时写入 + kuaixun 502 自愈，均 DB/日志实测复核。
- 下轮维度：h（空状态/边缘，第 2 轮）

### Run 16 — 2026-07-27 12:xx · 维度 h 空状态/边缘（第 2 轮）
- 先回归：de-AI 全站扫后边缘/空状态仍体面——美股英伟达/退市泽达/北交所0新闻/PERSON 页全 200、emoji=0、空态提示正常（「暂无相关资讯」）。
- **发现+修复（安全 TDD，高价值）**：**330 只北交所 920xxx 新代码段股票被当成非 A股**。北交所 2025 起启用 920xxx 新码（贝特瑞/锦波生物/曙光数创…），但 `tickerToSymbol`/`tickerToSecid`/`exchangeFromCode` 只认旧码 8/4，不认 9 → 920xxx 全返 null：**无行情卡、无到价提醒、催化日历被 isAShareTicker 门控关掉（当美股待遇）、交易所标签错成 SZ**。证据：DB 330 只 9-prefix 全是 920xxx；直探 sina `bj920238` 返真行情（长鹰硬科）。TDD：quote.test/universe.test 加 920xxx→bj/0./BJ + isAShareTicker=true 4 断言(RED→GREEN)；quote.ts 两函数 + universe.ts exchangeFromCode 各加 `startsWith("92")`→北交所（精确避开 900xxx 沪 B 股，DB 实测无 900xxx）。另回填存量 330 只 `exchange` SZ→BJ。
- backlog 新增：① N 前缀次新名（N长鹰=长鹰硬科 首日「N」标记+截断）——`fix-prefixed-names.ts` 本就处理 N 前缀，但修前 920238 无 symbol 致名字回填失败；**本次北交所修给了 920xxx 可用 symbol，下次 fix-prefixed 跑应自愈**（待验证该 cron 在跑）。② 房地产空板块（0 成员）实体页仍在（200、非破，已被 allSectors 过滤不进发现页），属 dead-theme（原 backlog）。
- 部署：build exit0 → start-prod.sh(pid 81791) → 首页/CSS 935934f1696679be=200 + AI ping 200 + 密钥齐全。**live 实测**：贝特瑞(920185) 页行情卡渲染(text-3xl font-bold=2、修前=0)、交易所标签 BJ(SZ=0)、页 200。
- 自测：tsc 34（无新增）+ vitest 89 文件 **595** 全绿（+920xxx 4 断言 + tickerToSecid describe）+ 上述部署+live 双向验证。
- 下轮维度：i（去AI化增量巡检，第 2 轮）

### Run 17 — 2026-07-27 13:xx · 维度 i 去AI化增量巡检（第 2 轮）
- 方法：全库重扫 AI tell（Python Unicode 象形 emoji 全范围 + em-dash 从句 + hand-holding + 套话）+ 审首扫没覆盖的 6 页（feed/login/plus/profile/review/settings）。
- **首扫漏网（本轮补修，证据 grep 定位）**：3 处装饰 emoji 首扫的窄 grep 没抓到——daily-digest `📰`(解牛早报抬头)、investor-profile-card `🧭`(投资画像)、drift-guard-card `🛡️`——全换成 `bg-brand` 竖条。prose：profile「成本/仓位**为你**手录」→「由你手录」（语义更准 + 去 hand-holding）；review「…变化**——**纯依据…」去破折号从句；investor-profile 徽标「让提醒更懂你」(拟人营销)→「个性化提醒依据」。
- **确认干净**：全库象形 emoji（Python U+1F000–1FAFF 等全范围扫）除功能性 ★/☆（收藏/重点标记，非装饰、保留）外 **=0**；用户可见 em-dash 从句 =0；hand-holding/套话 =0。feed/login/plus/settings 4 页无 tell。
- 部署：build exit0 → start-prod.sh(pid 29779) → 首页/CSS 935934f1696679be=200 + AI ping 200 + 密钥齐全。**live 实测**：首页 DailyDigest 📰=0（解牛早报抬头改竖条）、首页象形 emoji=0。
- 自测：tsc 34（无新增）+ vitest 89 文件 595 全绿 + 上述部署+live 验证。
- 下轮维度：a（交互性/可点性，第 3 轮）

### Run 18 — 2026-07-27 13:xx · 维度 a 交互性/可点性（第 3 轮）
- 方法：清一个已 backlog 的 dimension-a 小项 + 扫新缺口（grep「名字 join 成纯文本」+ 抽查 my-watchlist/daily-digest/master-compass/investor-profile）。
- **修复（安全 TDD，清 backlog）**：`portfolio-changed.tsx:115` 首页「今日无异动 · N 支已静音：A、B、C」的静音股名是纯文本 `map(m=>m.name).join("、")`、点不进个股页——改成逐个 `HoverPrefetchLink`→`/entity/{id}`（"、" 分隔，与 review 页静音区一致）。**TDD**：新建 `portfolio-changed.test.tsx`，renderToStaticMarkup 断言静音名出 `href="/entity/abc123"`（RED→GREEN）。
- **无新缺口**：review 页静音名本就是 Link ✓；my-watchlist 条目全 Link ✓；daily-digest 头条→`/news/{id}` ✓；alert-protocol「已开/已关」是提醒分类标签、无导航目标（非缺口）；master-compass/investor-profile 是指标/可视化卡（无 per-item 导航目标，同记分卡，非缺口）。
- backlog：清掉「PortfolioChanged 静音股名不可点」（标 ✅ 已修）。
- 部署：build exit0 → start-prod.sh(pid 10577) → 首页 200 + CSS cb7ec798faae7260=200(哈希随 portfolio-changed 改动更新) + AI ping 200 + 密钥齐全。（该组件仅登录态首页显示，curl 无 session 难直验；组件级由 render 测证明输出 `/entity/` 链接。）
- 自测：tsc 34（无新增）+ vitest **90 文件 596** 全绿（新增 portfolio-changed 1 测）+ 部署验证。
- 下轮维度：b（显示 vs 全量/最新数据，第 3 轮）

### Run 19 — 2026-07-27 13:xx · 维度 b 显示 vs 全量/最新数据（第 3 轮）
- 方法：grep 各 router `take:N` 逐个对 UI 计数标签（找 run 10 那类「截断值当全量」）；北交所修 + de-AI 后回归核对覆盖计数。
- **无假计数、无回归**（证据）：① 覆盖数首页仍「5492 只 A股 · 140 个行业」= DB 精确匹配（北交所 920xxx 修 + exchange 回填后未变）；② ecosystem「竞品 · N」N=selectPeers 实际展示数（count 与 chip 一致、非总数claim，honest）；③ related/relation/scorecard/follower 计数均「N=展示数」或真 count()（run 2/10 已治）；④ milestone take:200 已 run 10 修（显真实 total）。
- **发现（低优先 backlog，非假计数）**：`/feed` 资讯流 `take:50` + 无 Pager/加载更多——`surfacingSince` 时间窗内按 `importance desc, publishedAt desc` 取前 50。**不宣称总数（无假计数）**，目标用户自选 3–10 只、窗内 50 条通常够，故低优先。附带：masthead「你自选股的最新动态」偏「最新」而实按重要性优先排（元数据已诚实写「按重要性与时间排序」）——改措辞 or 加分页＝产品决策，记 backlog。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：只查轮，覆盖计数 DB vs 显示实测匹配、各 take 对应 UI 计数逐个复核、feed 排序+无分页读源确认。
- 下轮维度：c（静默故障，第 3 轮）

### Run 20 — 2026-07-27 14:xx · 维度 c 静默故障（第 3 轮）
- 常规健康：prod 日志(pid 10577)零 error/exception；AI 功能级 deepseek 完成 200+content；ingest 一次瞬时 `kuaixun 502` 已自愈（后续 inserted=20/30/30、有日志非静默）。
- **run 16 北交所修无静默故障（端到端实测）**：直调 fetchQuote/Kline/Valuation——长鹰硬科(920238) 价64.07/+14.3%/kline2点(次新,graceful)/PE21.81·61亿；贝特瑞(920185) 20.06/kline60点/PE26.57·228亿；茅台对照正常。行情/K线/估值全返正确数据、无 throw、无脏值。
- **⚠️ 确认的静默故障：brief-recent cron 停了**（run 11 backlog 坐实）。证据：候选池 run11=3→run15=1→run20=**10**，2h 涨 9 条重磅 thesis-公司资讯没被 brief。已第 2 次手动清空（10/10 成功、AI 路径再证健康）。根因＝调度非代码（session-scoped cron 重启即死）；手动清是 band-aid 不可持续。durable fix 需 sway 在 dashboard 重登记（命令已记 backlog；要我用 cron skill 帮登记就说一声——不擅自建带成本的它源 cron）。
- backlog：brief-recent cron 条升级为「已确认停·需 sway 决策」（附重登记命令 + 备选：并进 ingest 需先给 ingest cron 注 AI 密钥）。
- 部署：**无**（无代码改动；仅跑 brief-recent 数据维护脚本，非 build/重启）。
- 自测：日志/AI/北交所路径逐条带证据实测；brief 池增长趋势确证 cron 停 + 清后 10/10。
- 下轮维度：d（覆盖缺口，第 3 轮）

### Run 21 — 2026-07-27 14:xx · 维度 d 覆盖缺口（第 3 轮）
- 方法：验 run16 预测的 N长鹰 自愈 + coverage-report 基线对比 run12 + **新角度：反向 diff（可交易全集 vs DB，找缺失股，run12 只查了池里死实体）**。
- **N长鹰 已自愈 → 长鹰硬科(920238)** ✓（run16 给 920xxx 可用 symbol，fix-prefixed-names 重取真名成功；临时前缀名残留=0，说明该 cron 活着，与死了的 brief-cron 不同）。
- **覆盖稳定**：coverage-report——STOCK 5492、资讯 649701(+787 vs run12,在长)、有任意资讯 98.5%、thesis 热门 130/130、**完全空白 81(与 run4/12 持平、无新增)**。
- **修复（安全数据维护，闭覆盖缺口）**：反向 diff 当前可交易 A股(push2delay **5883**) vs DB(5492)→ 422 缺失：**415 ST/*ST 按设计拒(非缺口)**，**7 只正常股漏了**（白云机场600004/上海家化600315/氯碱化工600618/海欣股份600851/锦江在线600650/信雅达600571/腾龙股份603158，都是知名正常股）。用 `add-stocks.ts` 补齐（幂等建 COMPANY+STOCK+ISSUES + 巨潮公告回填 fetched70/inserted64/tagged146）。STOCK 5492→**5499**，7 只均绑 8-10 条公告；live 实测白云机场页 200+行情卡渲染。
- backlog 新增：seed-universe 非常驻 cron → 新股/复牌股累积缺口（见上方 backlog，需 sway 定是否挂 cron）。
- 部署：**无**（无代码改动；add-stocks 是数据维护脚本、force-dynamic 立即生效，非 build/重启）。
- 自测：N长鹰名/coverage 数/反向 diff/7 只入库+绑定/白云机场页渲染，均 DB+live 实测复核。
- 下轮维度：e（坏链/404/500，第 3 轮）

### Run 22 — 2026-07-27 14:xx · 维度 e 坏链/404/500（第 3 轮）
- 方法：主路由 + 回归 run16/21 改动（7 新股 + 北交所页）+ 重跑 internal 链接爬取 + sitemap 计数。
- **全绿无坏链**（证据）：① 主路由 13 条（/ /discover /feed /notifications /profile /review /plus /settings /login /onboarding /sitemap /robots）全 200；② run21 新加 7 只股（白云机场/上海家化/氯碱化工/海欣/锦江在线/信雅达/腾龙）实体页全 200；③ 北交所 920xxx（贝特瑞）200；④ 从 5 个种子页（含新股/北交所）爬 **582 条唯一 internal 链接逐个 curl = 0 非 200**；⑤ sitemap 16128→**16142**（+14＝7 新股的 STOCK+COMPANY 实体，正确纳入）。
- **已知项（未变）**：`/entity|/news/坏id` 仍返 200 非 404（force-dynamic notFound 状态码失效，run5/13 记 backlog、低影响+noindex）。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：主路由/7 新股/北交所/582 链接/sitemap 计数均 curl 实测复核。
- 下轮维度：f（文案准确性，第 3 轮）

### Run 23 — 2026-07-27 14:xx · 维度 f 文案准确性（第 3 轮）
- 方法：本轮核心＝**验 de-AI 大改（runs 14-17 重写 ~20 处文案）有没有把文案改准→改错** + 硬编码/过时计数 + 北交所纳入后的口径。
- **de-AI 文案准确（逐条对齐行为）**：① 关于卡列的源（东财公告/华尔街见闻/东财快讯/集微网）vs coverage-report 实际源全对得上、都在库且活跃（556708/3832/14143/47），是代表性「关于」blurb 非穷举；② 首页「A股每天上万条公告和资讯」＝市场级噪声定性说法（东财公告一年回填 556708≈1500/日 + 媒体，活跃日上万可信、非可证伪的精确窗）；③ entity SEO 4 类描述 / morning-briefing 静音 / portfolio-impact / seo SITE_DESCRIPTION 重写后均与行为一致。**de-AI 未引入 label≠behavior**。
- **北交所口径正确**：run 16 把 920xxx 当 A股后，催化日历「A 股法定披露截止日」对北交所也**准确**（北交所是 A股交易所、同受 CSRC 定期报告截止日约束）。
- **无用户可见过时计数**：覆盖数是动态 `{totalStocks}`→现显 5499（非硬编码）；`opportunity.ts:2「501 家」`是历史设计**注释**（非用户可见、且该文件未被 app import），非文案 bug。market-strip「沪深」是 CN 指数组标签（上证/深证/创业板/科创50/沪深300 均沪或深，准确）。
- backlog：无新增（opportunity.ts 501 注释可选清理、极低价值，未动）。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：de-AI 各改写逐条对行为/源核对、北交所披露口径核对、覆盖计数动态确认，均实测。
- 下轮维度：g（数据新鲜度，第 3 轮）

### Run 24 — 2026-07-27 20:55 · 维度 g 数据新鲜度（第 3 轮）
- 方法：逐源 createdAt 新鲜度 + 未来戳 + brief 池 + run21 新股增量。今天周一收盘后（20:55）。
- **管线很健康 + 市场源已解冻**：近24h 入库 **1433**、24/24 小时都有写入；周一收盘后 billboard/blocktrade/exechold 全部解冻（龙虎榜98/大宗49/董监高33 近24h、最新 0.1-3.5h，run15 预测的「今晚才来」兑现）；kuaixun 639/announcement 372/wallstreetcn 136 全新鲜；report 57h/stocknews 55h 是冷尾轮换（run7 已 backlog）。run21 新加 7 只股近24h 65 条资讯（在被覆盖刷新）✓。
- **发现+修复（安全 TDD，run7 的推广）**：**publishedAt 落未来 8 条**（run15=0，回潮）——eastmoney-shareholder 5 条（`CHANGE_DATE` 打 `T18:00:00+08:00`、日期是今/明天→落未来 +21h）+ jiwei-hbb 3 条（源自带未来 pubDate +3-5h）。run7 只按源钳了 forecast，新源又冒出来。改成**runner 级统一钳位**：加纯函数 `notFuture(d,now)`（lib/format）+ TDD 2 测，runner 循环顶把 `r.publishedAt=notFuture(...)`（判重 key + 入库都用钳过值），一处挡所有源。清存量 8 条（publishedAt→createdAt，8→0）。
- **⚠️ brief-recent cron 仍死**：候选池 run20 清空后 → run24=**17**，持续涨、确定没在跑（backlog 已升级、等 sway 决策；本轮未再手动清，band-aid 不可持续）。
- 部署：**无**——runner/notFuture 仅被 tsx ingest 用、不在 Next bundle（grep src/app+api 无引用），下轮 ingest cycle 自动生效（同 run7）。
- 自测：tsc 34（无新增）+ vitest 90 文件 **598** 全绿（+notFuture 2 测）+ 未来戳 8→0 实测 + 源新鲜度逐个复核。
- 下轮维度：h（空状态/边缘，第 3 轮）

### Run 25 — 2026-07-27 21:xx · 维度 h 空状态/边缘（第 3 轮）
- 方法：查未验过的结构性边缘实体（无码 COMPANY / 单成员板块 / 超长名 / 近乎空正常股）+ de-AI/北交所/新股后回归。
- **边缘实体全体面**（证据 curl）：① 旅游零售（2 成员小板块）200、emoji=0、feed「暂无相关资讯」、H1 正常；② 华润新能 / 豪威集团（无码 COMPANY，未上市/子公司主题实体）200、emoji=0、H1 正常、无行情卡（无发行股票→正确不显，run8 门控对 COMPANY 也生效）；③ 中国北车（死实体 1 条旧闻）200、H1 正常。
- **无新边缘 bug、无回归**：超长名（≥10 字）实体 = 0（无布局溢出风险）；近乎空的「正常股」其实全是死/更名实体（中国北车→中车、上实医药→上药、首商股份、东方锅炉——run12 死实体 backlog）；de-AI 后所有边缘页 emoji=0；北交所/新股（run16/21）页此前已验 200+行情。temp-name N长鹰 已 run21 自愈。
- backlog：无新增（无码 COMPANY / 2 成员板块 属结构性薄但渲染体面、非 bug；死实体在 run12 backlog）。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：4 类边缘实体 curl 实测 200 + 空态提示 + emoji=0 + H1 渲染，逐条复核。
- 下轮维度：i（去AI化增量巡检，第 3 轮）

### Run 26 — 2026-07-27 21:xx · 维度 i 去AI化增量巡检（第 3 轮）
- 方法：全库重扫 emoji/tell 确认无回潮 + **扩到首扫没覆盖的文案面：邮件模板 / 错误·toast / auth 消息**。
- **无回潮**：象形 emoji 全库 13 处全是功能性（★/☆ 收藏·重点标记）或**脚本 CLI 标记**（coverage-report ★、backfill-check ⚠——console 输出非 UI）——**UI 装饰 emoji=0**；用户可见 em-dash 从句 / 替你帮你为你 / 营销套话 三项 grep **均=0**（run 18/24 只加了链接+代码注释、无 AI 文案）。
- **新覆盖面均已干净**（无需改）：① OTP 邮件模板（`email.ts`）「你的解牛登录验证码：X。10 分钟内有效；如非本人操作请忽略。」——标准人味、无 slop；② 错误/toast「暂时无法作答，请稍后再试」「解读生成失败，请稍后重试」——标准；③ auth 消息「请 60 秒后再获取验证码」「验证码请求过于频繁，请稍后再试」——标准 terse，无 AI 味。
- backlog：无新增。（brief-recent cron 仍死＝dimension c 的 backlog，本轮 i 不重复处理，等 sway 决策。）
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：emoji Python 全范围扫 + 三类 tell grep + 邮件/错误/auth 文案逐条读，均实测确认干净。
- 下轮维度：a（交互性/可点性，第 4 轮）

### Run 27 — 2026-07-27 21:xx · 维度 a 交互性/可点性（第 4 轮）
- 方法：查还没深审的展示型卡 + 找「看似可点实则死」的元素（cursor-pointer/hover 用在非交互元素上）+ review 页复核。
- **无新缺口**（证据）：① drift-guard / logic-tracker / master-compass / investor-profile 四张卡**不引用任何实体/新闻**（无 entityId/newsId/name 展示，纯数据/可视化，同记分卡=无导航目标，非缺口）；② `cursor-pointer` 全库仅 2 处、都在真交互元素上（entity 页 `<summary>` 原生可点、morning-briefing 仅在 StatCard 是 `<a>` 时加）——**无 fake-clickable**；③ review 页 changed 段 + 静音段实体名全是 Link（run18 修的静音链接 + changed 段 `<Link>{c.name}`）。
- 结论：app 可点性经 run 1/9/18 三轮修复已成熟（工作台卡名 / thesis 信号新闻 / 静音股名），本轮无新可修缺口。
- backlog：无新增。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：4 卡引用扫 + cursor-pointer 全库审 + review 页 Link 复核，逐条实测。
- 下轮维度：b（显示 vs 全量/最新数据，第 4 轮）

### Run 28 — 2026-07-28 00:55 · 维度 b 显示 vs 全量/最新数据（第 4 轮）
- 方法：覆盖计数回归（run21 +7 后）+ 新一天（周二 00:55 CST）的日期依赖显示。
- **覆盖计数准**：DB STOCK(有ticker)=5499、有成员 SECTOR=140 → 首页显「已覆盖全部 **5499** 只 A股 · **140** 个行业」精确匹配（run21 add-stocks +7 由动态 `{totalStocks}` 正确反映）。
- **疑似陈旧日期 → 带证据证伪（差点踩坑）**：初见登出态首页含「2026-07-27」，疑 dateLabel 未随新一天滚动。核查：① dateLabel 是点分格式 `2026.07.28`、且只在登录态「投资晨报」出现——登出态首页根本没有它；② 那个「2026-07-27」是 RSC payload 里新闻的 `publishedAt` **UTC-ISO 时间戳**（机器可读、正确），非可见标签；③ 服务器 TZ **确认是 CST**——新闻页 `<time title="2026/7/28 00:52:14">`（toLocaleString 无 timeZone 用服务器 TZ）显 CST 而非 UTC。故 dateLabel/streamStamp（都用服务器 `new Date()`）渲染 CST 正确，**无时区/陈旧 bug**。（"16:52" 之类是 ISO dateTime attr 的 UTC 分量，非可见 streamStamp。）
- backlog：无新增。
- 部署：**无**（无代码改动；证伪了假 bug，未擅自改已正确的 TZ）。
- 自测：DB 计数 vs 首页显示实测匹配；服务器 TZ 用 toLocaleString 渲染值证实为 CST；"07-27" 上下文确认是 ISO publishedAt 非标签。
- 下轮维度：c（静默故障，第 4 轮）

### Run 29 — 2026-07-28 01:55 · 维度 c 静默故障（第 4 轮）
- 常规健康：prod 无 server 崩错；AI deepseek 200；ingest 一次瞬时 `kuaixun 502`（自愈老样子）。
- **✅ run 24 notFuture 钳位生产验证**：未来戳总数 **0**、近 3h 入库 45 条其中未来戳 **0**（run24 时是 8，说明 runner 级钳位已由 tsx 下轮 cycle 应用、对所有源生效）。当时无法当场验（tsx 才生效），本轮坐实。
- **prod 日志 `Failed to find Server Action "x"` ×2 → 证伪为良性噪声**：全日志仅 2 次（连续、疑同一 stale client 重试）；关键——**app 全库 0 个 `"use server"`**（所有 mutation 走 tRPC），故没有任何真实用户流会产生此请求。是过期 tab / bot 打了个 Server-Action 形状的请求、当前 tRPC 架构没有该路由，Next 自己回错。**无功能受损**（登录/加股/关注/决策/收藏全走 tRPC、各轮 200+功能验证均通）。非产品 bug、不 backlog。
- **⚠️ brief-recent cron 仍死**：候选池 run20 清空→24=17→29=**18** 续涨。escalation 挂在 backlog（等 sway 决策，本轮未再手动清）。
- backlog：无新增。
- 部署：**无**（无代码改动，纯查+记录+验证）。
- 自测：未来戳 0（run24 验证）、AI 200、Server Action 错误用「app 0 server action」证伪、brief 池趋势——均实测。
- 下轮维度：d（覆盖缺口，第 4 轮）

### Run 30 — 2026-07-28 02:xx · 维度 d 覆盖缺口（第 4 轮）
- 方法：复查 run 21 的反向 diff（当前可交易全集 vs DB，找漏股）——验 run21 补的 7 只是否够 + 距上次半天有没有新累积；+ coverage-report 基线。
- **正常漏股 = 0**（证据）：push2delay 可交易全集 **5883** vs DB STOCK **5499** → 缺 415，**全是 ST/*ST/退/基金**（isSeedableStock 按设计拒，非缺口），**正常该覆盖却漏 = 0**。run 21 补的 7 只已闭合缺口、半天内无新累积。
- **覆盖基线稳**（vs run 21）：STOCK 5499、COMPANY 5497(+7 新股的 company)、资讯 650270(+569 在长)、绑码 100%、thesis 热门 130/130、有任意资讯 98.5%、**完全空白 81（run4/12/21/28/30 一路持平）**。近7天 59.9%（run21 63.3%）＝已知波动阈值（周末活跃度滑出 7 天窗，看日环比非绝对）、非回归。
- backlog 更新：seed-universe 非常驻 cron 条**降级为低优先**——半天 0 新漏、累积速率极低（新 IPO 稀疏），「每轮 d 顺手 diff 补」（loop 本就在做）已足够兜底，dashboard cron 可选。
- 部署：**无**（无代码改动；本轮 0 漏股、无需 add-stocks）。
- 自测：反向 diff（正常漏股 0）+ coverage-report 基线逐项 vs run21 对比，均实测。
- 下轮维度：e（坏链/404/500，第 4 轮）

### Run 31 — 2026-07-28 02:xx · 维度 e 坏链/404/500（第 4 轮）
- 方法：主路由 + internal 链接爬取 + sitemap + **新角度：tRPC 端点喂边缘/畸形输入看是否 500**（自 run18 起没再部署、路由稳定，故本轮重点在 API 错误路径）。
- **全绿无坏链**（证据）：① 主路由 12 条全 200；② 5 种子页（含新股/北交所）爬 **582 条唯一 internal 链接 = 0 非 200**；③ sitemap 16142（与 run22 持平，无新实体）。
- **tRPC 边缘输入全优雅、无 500**（新验证）：getById(坏 id)=200(返 null)、news.byId(坏 id)=200、newsPage(page=99999 越 zod max500)=**400**、getById(缺 id)=**400**、畸形 input=**400**——校验失败返 400、not-found 返 200，**没有 500**，输入校验健壮。
- **已知项（未变）**：`/entity|/news/坏id` 仍 200 非 404（force-dynamic notFound 状态码失效，backlog、低影响+noindex）。
- backlog：无新增。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：主路由/582 链接/sitemap/5 个 tRPC 边缘输入均 curl 实测 HTTP 码。
- 下轮维度：f（文案准确性，第 4 轮）

### Run 32 — 2026-07-28 03:xx · 维度 f 文案准确性（第 4 轮）
- 方法：查 runs 6/14/23 还没核对的**具体数字/窗口 claim**——「过去30天回顾/这一个月」「onboarding 过去30天」「3–10 只」「30秒Top3/3分钟Top6」——逐个对后端窗口/枚举。
- **全部准确**（证据）：① review「过去 30 天」/「这一个月」= `changed({days:30})` + `since=now-30*24*3600e3` 过滤，正好 30 天 ✓；② onboarding「过去 30 天」= `activationDemo` 默认 `days.default(30)`（loading/空态硬编码 30 + 结果行动态 `{demo.data.days}`=30，一致）✓；③ daily-digest 详略「30 秒/3 分钟/深度」= `DEPTH_COUNT {30s:3,3min:6,deep:Infinity}`，与注释「Top3/Top6/全部」及行为一致 ✓；④ my-watchlist「只看你在乎的 3–10 只」= **使用建议**（watchlist 硬上限是 `max(100)`），非「只能加 10 只」的行为 claim，属引导文案、可接受。
- 结论：无「近两周=37天」式 label≠behavior。copy 经 run6(旧覆盖文案)/14(时间窗+枚举)/23(de-AI 准确性)/32(剩余数字claim) 四轮已全面核对准确。
- backlog：无新增。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：review/onboarding/digest 窗口对后端源码、watchlist 上限对 zod，逐条实测。
- 下轮维度：g（数据新鲜度，第 4 轮）

### Run 33 — 2026-07-28 05:55 · 维度 g 数据新鲜度（第 4 轮，周二盘前）
- **管线健康 + 钳位守住**：近24h入库 **1536**、**24/24 小时都有写入**；**未来戳 = 0**（run24 notFuture 钳位持续稳定）。kuaixun 689/wallstreetcn 180 最新 0.3h、活跃。
- **各源新鲜或已解释、无新陈旧**：announcement 8.6h / 市场源(billboard/blocktrade/exechold/shareholder) 9-12h = 周二 05:55 盘前正常（周一数据已入、周二的盘后才来）；report 66h / stocknews 64.6h = 冷尾轮换（run7 已 backlog）；jiwei 9.7h 低量；cninfo 12h 弃用源。
- **brief 池 18（持平 run29）**：未续涨——盘前隔夜市场关、无新重磅 thesis-公司条目进池（cron 仍死、但没料可积；若 cron 复活池会降而非平）。escalation 仍挂 backlog 等 sway。
- backlog：无新增。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：逐源 createdAt 新鲜度 + 24/24 小时 + 未来戳 0 + brief 池，均 DB 实测。
- 下轮维度：h（空状态/边缘，第 4 轮）

### Run 34 — 2026-07-28 06:xx · 维度 h 空状态/边缘（第 4 轮）
- 方法：换没深测的面——**新闻详情页边缘**（仅标题无正文 / 0 实体绑定 / 超长标题）。
- **发现+修复（安全，高影响面）**：新闻详情页正文渲染 `n.summary ? <p>{summary}</p> : 仅标题提示`——当 **summary==title（冗余）** 时，正文把 H1 标题**再显示一遍**。DB 实测 **content=null 且 summary=title 的新闻有 564,774 条**（东财公告主力体裁：只有标题、正文是源头 PDF），即 ~56 万个详情页标题显示两遍。NewsCard 早已用 `summaryIsRedundant` 挡（`news-card.tsx:49`），但详情页没用。修：详情页正文条件加 `&& !summaryIsRedundant(n.title, n.summary)`——冗余时落到「本条仅标题，点查看原文」（更干净 + 更准：告诉用户去源头看完整公告）。`summaryIsRedundant` 是已测纯函数（format-relative.test 断言 ==title→true）。
- **其余边缘体面**：0 实体绑定新闻（特朗普宏观）正确隐藏实体 chip 区；120 字超长标题 H1（text-balance）正常换行；均 200。
- 部署：build exit0 → start-prod.sh(pid 76388) → 首页/CSS cb7ec798=200 + AI 200。**live 实测**：冗余页（法律意见书）现显「本条仅标题」×1（不再重复标题）；正常摘要页（特朗普）「仅标题」=0、摘要片段「达成新协议」仍在（真摘要不受影响）。
- 自测：tsc 34（无新增）+ vitest 90 文件 598 全绿（用已测 summaryIsRedundant，无新测）+ 上述部署+live 双向验证（冗余→仅标题、正常→留摘要）。
- 下轮维度：i（去AI化增量巡检，第 4 轮）

### Run 35 — 2026-07-28 06:xx · 维度 i 去AI化增量巡检（第 4 轮）
- 方法：回归确认无 emoji/tell 回潮 + 查还没系统看的面——**输入框 placeholder / aria-label / 按钮 CTA**。
- **无回潮**：Python 全范围扫非 ★☆ 的 UI 象形 emoji = **0**；em-dash 从句 / 替你帮你为你 / 一站直达第一时间打造 三 grep 均 = 0（run34 只改了 summary 显示条件、没加新文案）。
- **新覆盖面均干净**：① 所有 placeholder 简洁人味+具体示例（decision「记下理由日后自查」、onboarding「兆易创新 / 603986」「国产存储替代 + 车规放量」、ask-jieniu「问关于你持仓…的问题」、login/password 标准）；② aria-label 全 terse 功能性（关闭/通知/查看原文/色盲友好配色/分页/删除提醒）；③ 无营销体长 CTA（无「立即开启/马上体验/了解更多」，CTA 都是「邮箱登录」「查看全部」这类 terse）。
- backlog：无新增。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：emoji Python 全扫 + 三类 tell grep + 20+ placeholder + aria-label + CTA 逐条读，均实测干净。
- 下轮维度：a（交互性/可点性，第 5 轮）

### Run 36 — 2026-07-28 07:xx · 维度 a 交互性/可点性（第 5 轮）
- 方法：查还没验过的可点面 + run34 回归。① command-palette(⌘K) 结果是否真能跳；② run34 改了新闻详情页正文显示条件，回归确认那页链接没被碰坏。
- **command-palette 双通道可点**（此前未验的面）：结果行是 `<button onClick={go(href)}>`（go→`router.push`），nav 快捷项 + 实体搜索结果都绑定；键盘 ↑↓ 移动 + ↵ 前往（onKeyDown/moveHighlight）+ 鼠标 hover/click；遮罩 `aria-label=关闭搜索` 可点关闭。干净。
- **新闻详情页无可点性回归**（run34 只改正文 `<p>` 条件、未动链接结构）：DB 取一条有实体的资讯 `cms3xc6d7…`（4 实体）线上 curl → 渲染 **4 实体 chip(/entity/) + 1 查看原文外链(target=_blank) + 6 相关资讯(/news/)**，全部可点、HTTP 200。空实体条目 0 chip 属正常（非 bug）。
- 顺带观察（非本维度、记候选）：Interpretation（按需 AI 解读面板）total=7、近 24h/3h 均 0、最近一条 ~14.8 天前——但这是**用户点击才触发**的按需解读，0 大概率是无人点击而非坏；留作未来维度 c 候选（需判 InterpretationPanel 点开是否真出结果），本轮不追。
- backlog：无新增（brief-recent cron 重挂仍待 sway，状态未变）。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：command-palette 组件逐行读 + 新闻页链接线上 curl 复现（4/1/6，HTTP 200）。
- 下轮维度：b（显示 vs 全量/最新数据，第 5 轮）

### Run 37 — 2026-07-28 07:xx · 维度 b 显示 vs 全量/最新数据（第 5 轮）
- 方法：系统对账所有面向用户的计数/覆盖 claim vs DB 全量（「重点覆盖 130 vs 5495」血统面）。
- **discover 覆盖数字全部诚实（活验证）**：线上 /discover 渲染「已覆盖全部 5499 只」+ 分类计数 板块 141 / 公司 5497 / 股票 5499 / 人物 1，与 DB `entity.count` 逐一**精确相等**（totalStocks=count(STOCK,ticker≠null)=5499）。listByType 无 take（返全量），故分类旁 `{items.length}` 与「已显示前 90 / 共 N」是真全量——run 10 的诚实计数原则已一致覆盖全部四类。
- **entity 个股页计数诚实**：newsPage 的 `count()` where 与 items 的 take 查询 where 匹配（news tab=base、announce tab={base,PRIMARY}），pager total/pages 不误导；milestones total 走独立 count()，spanSummary 在 total>shown 时输出「显示前 200」披露截断。
- **复核已知 backlog（非新发现）**：大事记「一年脉络」对热门板块坍缩问题（见上方 backlog #大事记）仍现存——医药 tab「大事记 740」，直查最近 200 条 publishedAt 全在 2026-07-06..28（单月），整年最旧到 2025-07-31。诊断＝take:200-by-recency 取数策略问题（groupByMonth 分桶正确、非机械 bug），需产品决策换策略 → 维持 backlog、未擅自改。计数/caption 均诚实。
- backlog 新增：无（既有大事记条已补 run 37 复核证据 + 推荐修法）。
- 部署：**无**（无代码改动，纯查+记录）。
- 自测：DB `entity.count` 四类 + totalStocks 与线上 curl 逐一对平；医药 200 条日期跨度直查复现「单月」+ 线上 curl caption「覆盖 1 个月 · 显示前 200」+ 1 个 details 块。
- 下轮维度：c（静默故障，第 5 轮）

### Run 38 — 2026-07-28 11:xx · 维度 c 静默故障（第 5 轮）
- 方法：读 prod 日志 + boot 自检 + 猎吞错 catch + **功能级验证 AI**（非只看 200）+ 信号源静默失败探测。
- **查（均带证据）**：① boot「✓ 密钥齐全：AI + 邮件可用」；prod log 140 行、0 错误关键词。② 吞错 catch 分诊：`ai.ts:244` thesis 解析失败记日志+重抛、`email.ts:56` 记 `[email]...failed`+返 false、`ask.ts:121` 已按 7-24 修；仅 layout/daily-digest 的裸 catch 是 localStorage 渐进增强（吞了无害）。③ **AI 功能级**（lessons：带外部 key 的功能必须验功能本身）：`secret exec` 真实 deepseek chat 往返 **HTTP 200 / 2.85s / 返「正常」** + /models 200 → key 有效、deepseek 未被 geo-block、非空返静默（真 LLM 延迟非秒回）。**闭合 run-36 候选**：interpret.getOrCreate 生成路径需登录（93-98），Interpretation「15 天 0」= 无登录用户点击、非故障。④ 信号源：EntitySignal 5 类（margin1387/consensus2004/unlock472/commodity2/overseas1）**最新 updatedAt 全 0.3h 前** → 全在产出、无静默失败（commodity/overseas 低计数是板块级天然稀疏）。
- **修（安全/机械·TDD·ingest-only）**：signals.ts 5 个逐类 `catch { /* 跳过 X */ }` 是**裸吞错零日志**（7-24 事故同款反模式：某源端点变了会 100% 失败却零痕迹，只能靠查库发现）。5 处全改 `catch (e) { console.error("[signals] X skipped:", e instanceof Error ? e.message : e) }`——只加可观测性、行为不变（仍跳过续跑）。RED：新测 2 条（mock fetch reject + spy console.error）先失败（`expected '' to contain 'commodity'`）→ GREEN 12/12。
- backlog 新增：无。
- 部署：**无需 build/重启**——signals.ts 仅被 `src/scripts/ingest.ts`（tsx cron 从源跑）引用、不在 Next bundle，改动下个 ingest 周期自动生效。Web 服务未扰动（首页 200 + CSS cb7ec798faae7260 200）。
- 自测：RED→GREEN（signals 12/12）；tsc 34（全旧基线 opportunity/search.test，0 新增）；vitest 90 文件 600 全绿（+2 新测）；AI 真实往返 200/2.85s；信号 5 类新鲜度直查复现。
- 下轮维度：d（覆盖缺口，第 5 轮）

### Run 39 — 2026-07-28 11:xx · 维度 d 覆盖缺口（第 5 轮）
- 方法：复跑反向 diff（push2delay 实时可交易全 A股集 vs DB STOCK）+ 查未分类 STOCK 总量。
- **反向 diff（带证据）**：可交易全集 5884 / seedable 正常股 5392 / 排除(ST/退/ETF/临时名) 492；DB STOCK 5499（全有 ticker）。**正常股在全集却漏在 DB = 1 只**：`920165 珈凯生物`（北交所 920xxx 新股，正常名、在实时全集；pre-check 确认 DB 任何形态都无）。
- **修（安全/机械·数据补齐，非代码改动）**：`add-stocks.ts 珈凯生物:920165` → ensureStockEntities 建 COMPANY+STOCK+ISSUES（与自助加股路由共用、已测代码）+ 巨潮回填（fetched10/inserted2/tagged4）。验证：STOCK `珈凯生物(920165)`/COMPANY 已建、2 条公告、个股页 `/entity/cms44l94s…` **HTTP 200**（渲染股名 16 次）。缺口闭合（唯一缺的 920165 已入库）。此即 run 30 定的「每轮 d 顺手 diff 补」兜底机制。
- **观察（backlog 数据）**：未分类 STOCK（0 条 BELONGS_TO）共 144（沪107/深32/北交老3/北交920 2），**样本大量是「退市X」死壳**（退市泽达/观典/紫晶/太和/中新/博天…）——即已知「死实体」backlog（run 12）的当前规模，非新分类缺口；珈凯生物 + 少数活北交所是真·未分类活股的尾巴。分类走 seed-industries（全量 reseed）、死壳清理走 exclude-vs-delete 产品决策——均维持 backlog、本轮未擅动。
- backlog 新增：无（未分类 144 归入既有死实体条，已补当前数字）。
- 部署：**无需 build/重启**——纯 DB 数据补齐（add-stocks 直写库），Web 服务立即可见（/entity 200）。无代码改动。
- 自测：pre-check 确认 920165 缺 → add-stocks → 复查 STOCK/COMPANY 已建 + news=2 + 个股页 200 渲染股名。tsc/vitest 不适用（无代码改动）。
- 下轮维度：e（坏链/404/500，第 5 轮）

### Run 40 — 2026-07-28 13:xx · 维度 e 坏链/404/500（第 5 轮）
- 方法：核心路由/边缘参数 HTTP 扫 + 521 条内部链接深爬 + **新角度：采样各源「查看原文」外链查系统性坏链**。（注：zsh `(eval)` 包装下 curl/sed 在循环里 command-not-found，改用 `/bin/bash` 脚本文件 + `/usr/bin/curl` 绝对路径绕过。）
- **内部全绿**：核心路由 + sitemap/robots 全 200；边缘参数 `?page=99999`/`?type=BOGUS`→200 优雅、`/totally-bogus-route`→404 正确、notFound()(坏 entity/news id)→200(已知 backlog)；深爬 521 条唯一内部链接 **0 非 200**；run39 新股页 920165→200(回归干净)。
- **发现真坏链（外链，带证据）**：采样 12 源各 3 条「查看原文」，10 源全 200，但 **`东方财富·股东增减持`（`/executive/gudong/{code}.html`）+ `东方财富·董监高增减持`（`/executive/gaoguan/{code}.html`）3/3 全 404**——同 UA 下其它 data.eastmoney.com 页均 200，排除 bot/transient。用户点这两类新闻「查看原文」落到 404。
- **修（安全/机械·TDD + 数据 backfill）**：正确 URL＝`data.eastmoney.com/executive/{code}.html`（同页含高管+股东增减持，实测 6 码含北交所 920xxx 全 200）。① 代码：`eastmoney-holderchange.ts` 两个纯函数 builder（L52 gaoguan、L113 gudong）URL 改为 `/executive/${code}.html`，新建 test（RED 2 条断言错路径→GREEN 2/2）。② backfill：DB 存量坏 URL **1077 条**（gaoguan550+gudong527）用 Prisma 类型化 API replace `/executive/gaoguan|gudong/`→`/executive/`，remainingBad=0。
- 验证：holderchange 新闻「索宝蛋白 股东…增持」页 200、查看原文 href=`/executive/603231.html`、该外链实测 **HTTP 200**——端到端修复。
- backlog 新增：无。
- 部署：**无需 build/重启**——eastmoney-holderchange.ts 仅被 `src/scripts/ingest.ts`（tsx cron）引用、不在 Next bundle（改动下个 ingest 周期生效）；backfill 是 DB 数据、Next 直接读库立即生效。Web 服务未扰动（首页 200 + CSS cb7ec798 200）。
- 自测：RED→GREEN（holderchange 2/2）；tsc 34（全旧基线、0 新增）；vitest 105 文件 713 全绿（总数较上轮 90/600 增长疑并行 session 加测、与本轮无关、0 失败）；外链修复 URL 6 码全 200；活验证新闻页查看原文 200。
- 下轮维度：f（文案准确性，第 5 轮）

### Run 41 — 2026-07-28 14:xx · 维度 f 文案准确性（第 5 轮）
- 方法：核对各处时间窗文案 vs 后端真实查询窗（「近两周=37天」类错配）。
- **多数窗文案准确**：daily-digest 市场段 近24h=DIGEST_WINDOW_HOURS ✓；radar 近3天=entity.ts:233 `3*24h` ✓；hot-sector 近7天=285/351 `7*24h` ✓；scorecard 近30日=647 `30*24h` ✓；portfolio-changed 近7天(首页 changed() 默认 7)✓；review「过去30天」=changed({days:30})+用自己的渲染(非 PortfolioChanged 组件)✓。
- **发现真错配（带证据）**：daily-digest 卡副标恒写「近 24 小时 · 重磅 N 条」，但它同时罩两段——「你的自选股」段=`news.personalDigest`（news.ts:120 窗口 **48h**「单只股票 24h 未必有料」）+「市场」段=`news.digest`（24h）。→ 登录+有自选股的用户，自选股段可含 24–48h 前的项却被标「近 24 小时」，label≠behavior。且「24」是硬编码字面（run 14 backlog item）。
- **修（安全/机械·TDD·Next-server 需部署）**：digest.ts 加 `PERSONAL_DIGEST_WINDOW_HOURS=48` + 纯函数 `digestWindowHours(hasPersonal)`（有自选股段→48、仅市场→24；48 是对市场段 24h 项的宽松但不失真上界）；news.ts:120 用该常量替内联 48（单一来源防漂移）；daily-digest.tsx 副标改 `近 {digestWindowHours(p.length>0)} 小时`（顺带消灭硬编码 24）。RED：digest.test +2 + 新建 daily-digest.test.tsx render 测 +2 先失败（有自选股段仍出「近 24 小时」）→ GREEN 6/6。
- backlog 新增：无。
- 部署：**是**（news.ts + daily-digest.tsx 在 Next bundle）。重读 start-prod.sh（今日被并行 session 改过、现多注入 AUTH_SECRET）→ `NODE_ENV=production npm run build` exit0（单独跑）→ start-prod.sh(pid 21983)：首页 200 + CSS 1b67a8c8d557f7df 200 + [boot]✓密钥齐全 + AI /models ping 200 + 登出态首页 digest 活渲「近 24 小时 · 重磅 6 条」(market-only 正确；48h 路径 component 测已证)。
- 自测：RED→GREEN 6/6；tsc 34（全旧基线、0 新增）；vitest 107 文件 723 全绿（我 +4 测）；build exit0 + 上述部署验证。
- 下轮维度：g（数据新鲜度，第 5 轮）

### Run 42 — 2026-07-28 15:xx · 维度 g 数据新鲜度（第 5 轮）
- 方法：createdAt 按小时聚簇（非行数）+ 未来戳 + 各源新鲜度 + 交叉查 run38 的 `[signals]` 日志 + 部署后日志巡检。
- **管线健康**：近24h 入库 1615、**24/24 小时都有写入**；未来戳 publishedAt>now = **0**（run24 notFuture 钳位持续稳）。多数源新鲜：wallstreetcn/快讯 0.4h、集微网 1.4h、公告/业绩预告 2.9h、巨潮 3.0h；龙虎榜/大宗交易 21h=周二盘后待更新（正常）；董监高 6.3h、股东增减持 19h。
- **发现（run-7 backlog 复核，恶化到 3 天 flat）**：个股资讯 73.6h + 券商研报 75.1h、近24h=0；按天聚簇确认**两源自 2026-07-25 起彻底 flat**（07-26/27/28 零写入）。ingest.ts:74/90 确认 report-refresh/media-refresh **仍在每轮 ingest 调用**（其它源新鲜=ingest 活着），但 `targetsByNeed` 只挑冷尾股 → 冷股无新研报=0 插入，同时热门股（覆盖多→永不入选）的每日新研报/媒体被系统性漏采。= run-7 backlog「研报/个股媒体只刷冷尾」，现症状=热门股这两个 tab 冻结 3 天。需产品决策（加热门股轮扫/按热度分层刷新）→ 维持 backlog、未擅动核心管线。
- **交叉发现（auth，非本维度，部署后日志巡检）**：run41 部署首次启用被并行 session 改过的 start-prod.sh（新注入 store 的 AUTH_SECRET 取代 .env 弱值）→ 旧会话 cookie 解不开、日志刷 `JWTSessionError: no matching decryption secret`。**功能级验证**：用当前 store AUTH_SECRET 铸 cookie（next-auth/jwt encode，sub=真实用户，salt=authjs.session-token）→ /review **HTTP200 认证态**（无「登录后查看」、有「回顾」masthead）→ 新会话解密正常。故这是 AUTH_SECRET 安全升级（弱→强）的**一次性代价**（旧用户需重登一次），非 auth 坏。
- backlog 新增：一条「JWTSessionError=AUTH_SECRET 升级的预期噪声、非 bug」防误判（见下）。
- 部署：**无**（investigate-only，无代码改动）。
- 自测：freshness 探针 + 按天聚簇复现两源 07-25 flat；auth 铸 cookie→/review 200 认证态复现新会话可用；未来戳=0 复现。
- 下轮维度：h（空状态/边缘，第 5 轮）

### Run 43 — 2026-07-28 16:xx · 维度 h 空状态/边缘（第 5 轮）
- 方法：curl 三类边缘实体页查空状态是否体面——美股(无 A股行情)、0新闻股、run39 新加的次新股；查红旗 token(undefined/NaN/Invalid Date) + 可见空状态文案（用 python 剥 `<script>` 区分可见 vs RSC payload）。
- **美股 英伟达 NVDA**：HTTP200；isAShareTicker gate 生效——**无 A股行情卡/催化日历/到价提醒**(催化=0/财报=0/行情骨架=0)，只渲染新闻；可见文本 undefined/NaN=0。decent（run8 gate 回归确认无恙）。
- **0新闻股 翰博高新(833994·北交所老码)**：HTTP200；「暂无相关资讯」正确空态 + 「财报日/解禁到期日需结构化日程源，暂未接入，不臆测」诚实兜底(不臆造) + tab 计数 资讯0/公告0 honest 零。行情 32.90 +0.00(北交所平盘、合理)。decent。
- **次新股 珈凯(920165)**：HTTP200；资讯3/公告3/大事记1(比 run39 的 2 条已增，ingest 在累积)；A股催化日历正确(半年报 8/31)。decent。
- **红旗 token 分诊**：三页「undefined」全文各 25、但**剥离 `<script>` 后可见文本 = 0** → 全在 RSC flight payload(序列化 props/state)、非用户可见；NaN/Invalid Date=0；「null」817 同理在 payload。非 bug。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：三边缘页 curl 复现 decent + python 剥 script 确认可见 undefined=0 + isAShareTicker gate 对美股生效复现。
- 下轮维度：i（去AI化增量巡检，第 5 轮）

### Run 44 — 2026-07-28 17:xx · 维度 i 去AI化增量巡检（第 5 轮末）
- 方法：回归扫（emoji + 4 类 tell grep）+ 查本 session 我改/加的代码有无引入用户可见 AI 味 + 新面（加载/错误/toast 态文案，前几轮 i 未深巡）。
- **回归全干净**：① Python 全扫非 ★☆ 象形 emoji=**0**（命中的 ✓✕↵— 全是功能符号、非装饰 emoji）；② 替你/帮你/为你 grep 9 处**全是单次功能性用法**（帮你自查 / 为你追踪 / 帮你盯），无叠用 hand-holding、无「替你」（run 35「0」是针对叠用 pattern，逐词广搜命中的是合法功能用法）；③ 营销套话用户可见=**0**（「私人投研工作台」仅存于 sidebar.tsx:71 / page.tsx:76 的**代码注释**，用户可见品牌是保留的「私人投研 Agent」sidebar:117/page:99）；④ 格言/对仗=**0**。
- **本 session 新增用户文案无 AI 味**：run34 新闻空态「本条仅标题，点下方「查看原文 ↗」阅读全文」简洁人味；run41 digest「近 N 小时 · 重磅 N 条」；批量执行（milestone/sitemap/hotStockTargets）只加逻辑+注释、无新用户文案。
- **新面（加载/错误/toast 态）干净**：加载中… / 生成中… / 正在添加… / 登录成功，跳转中… / 验证码错误或已过期，请重试 / 暂时无法作答，请稍后再试 / 请先登录后再自助添加自选——全简洁功能性人味，无 em-dash 从句/谄媚/营销。（唯一略生硬的「正在去这个 tab」是 tab-bar.tsx:18 注释、非用户可见文本。）
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：emoji Python 全扫 + 4 类 tell grep + 加载/错误文案逐条 + 注释 vs 可见判定，均复现干净。
- 下轮维度：a（交互性/可点性，第 6 轮起）

### Run 45 — 2026-07-28 17:xx · 维度 a 交互性/可点性（第 6 轮起）
- 方法：查还没验过的「展示其它实体/新闻却可能不可点」的数据卡 + 批量改动(milestone)交互回归。
- **ecosystem-coverage 全可点**：所属行业 sectors(L41)/竞品 peers(L71)/竞品新闻实体名(L80) 均 `<Link href=/entity>`；板块新闻 + 竞品新闻标题 HoverPrefetchLink→/news。
- **daily-digest 头条 + morning-briefing 可点**：DigestRow 标题 HoverPrefetchLink→/news(L45)；morning-briefing `<a href=#portfolio-changed/#catalyst-calendar>` 锚点跳 section。
- **thesis-earnings-check 正确不可点**：`d.matched` 标签是财务口径关键词(毛利率/营收 等筛选依据)、非实体/新闻、无 nav 目标 → 不该可点（非 gap）。
- **milestone 批量改动交互无回归**：医药 milestone tab HTTP200、13 月标签、**200 条 /news 可点链接**(NewsCard)，details 月折叠原生可展开——importance-desc 只改内容选取、render 结构与可点性不变。（`<summary>` grep 计数=1 是 RSC 压缩假象，200 链接+13 月标签为准。）
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：ecosystem/digest/briefing/earnings-check 组件逐读 + 医药 milestone 线上 curl(200 /news 链接) 复现可点。
- 下轮维度：b（显示 vs 全量/最新数据，第 6 轮）

### Run 46 — 2026-07-28 18:xx · 维度 b 显示 vs 全量/最新数据（第 6 轮）
- 方法：验批量改动后显示仍诚实 + 还没验过的计数——hot-sector memberCount（「130 vs 5495」血统面）+ milestone caption（run 44 我的修复）。
- **hot-sector memberCount 诚实（无 take 截断）**：allSectors 的 member rels 查询**无 take**（不同于 ecosystem 的 take:60），memberCount = 全量 BELONGS_TO 成员去重后计数。活验证：医药显示「**12 只 · 近 7 天 122 条**」= DB 医药 BELONGS_TO 成员 12（raw=distinct=12）。discover 40 板块均显真实成员数（196/265/246/107…）。
- **milestone caption（run 44 我的修复）诚实**：医药「共 740 · 覆盖 13 个月 · 显示前 200」——740=DB count(importance≥55,12mo)、13=top-200 跨越的月数、200=take 上限。全对，修复未引入显示不实。
- **d-lead（非本维度 bug，记给未来 d 轮）**：医药 theme-sector 只 12 个成员，远少于其它板块（196/265…）——疑 pharma 个股 BELONGS_TO 挂在「医药制造/生物医药」等**行业 sector**而非「医药」**theme sector**，theme sector 欠填充。显示对 b 是诚实的（=DB 12）；但覆盖/分类角度值得 d 轮系统查 theme-vs-行业 sector 的成员分布。
- backlog 新增：无（医药成员数记为 d-lead，非 b bug）。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：DB 医药 BELONGS_TO 成员数 + milestone count + 线上 discover 剥 `<!-- -->` 提取 memberCount(12) 复现。
- 下轮维度：c（静默故障，第 6 轮）

### Run 47 — 2026-07-28 19:xx · 维度 c 静默故障（第 6 轮）
- 方法：Next 日志 + AI 功能级 + 批量改动(run44)是否静默失败 + **ingest 日志**（run38 logging + 直接错误行；本轮首次定位到 `/Users/mac/jieniu-ingest.log`）。
- **Next 服务健康**：prod 日志 844 行、**0 错误关键词**；**JWTSessionError=0**（run42 的 AUTH_SECRET 升级噪声已散尽，印证一次性旧 cookie 判断）；boot ✓。
- **AI 功能级**：/models 200 + **真实 deepseek chat 200/3.07s/返「正常」**（真 LLM 延迟非吞）。
- **批量改动 live 生效、无静默失败**：ingest 日志 `[report-refresh] stocks=22(hot=10) inserted=0-1` / `[media-refresh] stocks=32(hot=12) inserted=23-59`——热门股轮扫每轮在跑（run44 修）；**run42 的 3 天 flat 源已恢复**：券商研报 1.0h 前、个股资讯 0.4h 前（近3h 入库 253）。signals 5 类全 0.4h 新鲜。
- **run38 logging 抓到 2 个瞬时失败、均已自愈**：`[signals] overseas skipped: fetch failed`×2（台股 TWSE OpenAPI 间歇不可达；overseas 现 0.4h 新鲜=已恢复）+ `[eastmoney-kuaixun] 502`×1（东财瞬时 502；快讯现 0.5h/近1h 入库 20=已恢复）——外部 API 抖动、非持续静默失败；run38 把静默 skip 变可见可诊断，正是其价值。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：Next+ingest 日志 grep + AI 真实往返 + signals/report/stocknews/kuaixun 新鲜度 DB 探针 + 瞬时失败 kind 定位，均复现。
- 下轮维度：d（覆盖缺口，第 6 轮）

### Run 48 — 2026-07-28 20:xx · 维度 d 覆盖缺口（第 6 轮）
- 方法：查 run46 的 d-lead（医药 theme-sector 只 12 成员）根因 + 常规反向 diff（每轮兜底）。
- **反向 diff 干净**：push2delay 可交易全集 5884 / seedable 正常股 5392 / DB STOCK 5500 → **正常股漏在 DB = 0**（920165 已在，无新 IPO 漏采）。
- **d-lead 确认 = theme-vs-行业 sector 分类重叠（非覆盖缺口）**：pharma 股其实**全覆盖**、分布在行业子板块——化学制药 149 / 医疗器械 134 / 中药 61 / 生物制品 56 / 医疗服务 53 / 医药商业 29；「医药」是稀疏 theme umbrella（12）。141 个 SECTOR 里近空的还有 房地产 0（已 backlog）、旅游零售 2、医疗美容 3、林业/体育/农业综合/其他家电 3… 用户看「医药 12 只」显著展示会误以为 pharma 覆盖差（实则齐全、在子板块）。股都在库都可搜 → 非覆盖缺口、是分类模型问题。
- backlog 新增：**theme-vs-行业 sector 分类重叠**（见上方 backlog，需 sway 定 sector 模型：聚合/隐藏稀疏 theme/删冗余；我倾向隐藏「有行业替代且 <N 成员」的 theme，最小改动）。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：DB 141 sector 成员分布 + pharma 子板块计数 + 反向 diff（0 漏）复现。
- 下轮维度：e（坏链/404/500，第 6 轮）

### Run 49 — 2026-07-28 21:xx · 维度 e 坏链/404/500（第 6 轮）
- 方法：延续 run40 的外链采样角度（每源 5 条、比 run40 的 3 条更广）+ 确认 holderchange 修复 live + 内部链接复爬（milestone 13 月 + sitemap + 新股后）。
- **外链全绿（60/60 = 200，0 个 404）**：12 源各 5 条「查看原文」全 200。**run40 的 holderchange 修复 live 确认**：股东增减持/董监高增减持现各 **5×200**（run40 是 3×404），URL 已是 `/executive/{code}.html`；个股资讯（热门股轮扫新增的高量 stocknews）5×200、URL 有效。
- **内部全绿**：核心路由 + sitemap/robots 全 200；深爬 **752 条唯一内部链接**（含医药 13 月 milestone 的 200 news 链接 + 珈凯新股页）**0 非 200**（比 run31 的 582 / run40 的 521 更多，因 milestone 从 1 月→13 月）。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：60 外链 HTTP 批量检查（/tmp/ext49.txt）+ 752 内部链接并行检查（/tmp/intbad49.txt=空），均复现 0 坏链。
- 下轮维度：f（文案准确性，第 6 轮）

### Run 50 — 2026-07-28 22:xx · 维度 f 文案准确性（第 6 轮）
- 方法：查两个还没核的数字/倒计时 claim——catalyst「还有 N 天」倒计时 + hot-sector「已覆盖全部 N 只 A股（+美股）」。
- **catalyst 倒计时 defensible（非 bug）**：首页显「半年报披露 8/31 最晚 · 还有 35 天」。earnings-calendar.ts deadline=08-31 **23:59:59（日终）**、daysUntil=`Math.ceil((deadline-now)/day)`（注释明写「向上取整」为有意）。07-28 22:30→08-31 23:59:59 = 34.06 天、ceil=35。权威日期「8/31」并列显示 → inclusive/ceil 的**有意选择**、非误导；非「近两周=37天」那种大偏离。
- **totalStocks「5500 只 A股（+美股）」= 已知死实体 backlog 的显现（非新 bug）**：totalStocks=count(STOCK,ticker≠null)=5500 = 5469 A码 + 31 美股，其中 77 是 ST/退/死壳。真实可交易 A股 ~5392；「5500 只 A股」被死壳虚高 ~108。「（+美股）」已 flag 美股；死壳虚高是 run 12/39 死实体 backlog（计数含死壳）在旗舰 claim 的显现，已在该 backlog 补 run50 证据。修复绑 exclude-vs-delete 决策（需实时全集交叉核对、无法 per-request 剔除）。
- backlog 新增：无（死实体 backlog 补 run 50 显现证据）。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：catalyst daysUntil 计算复现（ceil 34.06→35）+ DB 拆分 5500=5469 A码+31 美股(其中 77 ST/退/死) 复现。
- 下轮维度：g（数据新鲜度，第 6 轮）

### Run 51 — 2026-07-28 23:xx · 维度 g 数据新鲜度（第 6 轮，盘后近午夜）
- 方法：createdAt 按小时聚簇 + 未来戳 + 各源新鲜度 + **重点验 batch(run44) 修复的 report/stocknews 是否持续新鲜** + signals 5 类 + ingest 日志。
- **管线健康**：近24h 入库 2170、**24/24 小时都有写入**；未来戳=0（notFuture 钳位持续稳）。
- **batch 修复持续 holding（非一次性 blip）**：个股资讯 0.1h/近24h 723、券商研报 5h/近24h 5（run42 是 3 天 flat、run47 恢复、本轮**仍新鲜**=run44 热门股轮扫 fix 耐久）。
- **各源新鲜或已解释**：快讯/wallstreetcn 0.1h、公告 1.5h 新鲜；股东/董监高增减持 3h、大宗/龙虎榜 6.5-6.9h=盘后今日数据已入（正常）；cninfo 12h（弃用轮转源、东财公告 1.5h 已覆盖）、集微网 10.4h（低量 niche 媒体）；margin asOf 07-26（融资融券发布 lag）。
- **signals 5 类全 0.1h 新鲜**：overseas 现 0.1h/asOf 07-28=已从 run47 的 TWSE OpenAPI 瞬时 skip 恢复；无静默信号失败。ingest 错误仍 3 条（=run47 那批瞬时 kuaixun 502 + overseas skip×2、**未增长**）。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：per-hour histogram + 12 源新鲜度 + signals 5 类 updatedAt + ingest 日志 grep 复现。
- 下轮维度：h（空状态/边缘，第 6 轮）

### Run 52 — 2026-07-29 00:xx · 维度 h 空状态/边缘（第 6 轮）
- 方法：临时名(XD/DR)股 + batch(run44) milestone 改动对**低事件实体**是否体面 + PERSON 单实体。
- **临时名股 = 0**：DB 无 XD/XR/DR/N/C 前缀残留（fix-prefixed-names 自愈在起作用；00:55 盘前也无新 XD）。
- **低事件 milestone 边缘 decent（batch 改动安全）**：北方华创（5 个 milestone 事件）milestone tab HTTP200、可见 undefined/NaN/InvalidDate=0、caption「共 5 条 · 覆盖 4 个月」（<200 故**无**误导的「显示前 200」，spanSummary 只在 total>shown 时加截断标注）、按月分组渲染（2026年7月 1 条…）。importance-desc + 再按时间倒序对低事件实体正常，未破坏。
- **PERSON 单实体 decent**：赵海军页 HTTP200、可见 undefined/NaN=0；显 masthead/关注/记分卡/关联新闻(11天前媒体报道)/大师罗盘，**无错误展示 A股组件**（isAShareTicker 对无 ticker 的 person 返 false → 无行情卡/催化日历/财报前瞻）；1 条近 30 日资讯「低」热度、空态体面。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：3 页 curl（北方华创 milestone/主页 + 赵海军）+ python 剥 script 分析（可见 undefined/NaN=0、关键段落）复现。
- 下轮维度：i（去AI化增量巡检，第 6 轮末）

### Run 53 — 2026-07-29 01:xx · 维度 i 去AI化增量巡检（第 6 轮末）
- 方法：回归扫（emoji + tells）+ 查还没深巡的面（error.tsx 错误页 / notFound / AI 解读面板 chrome / ask 对话 chrome）+ 本 session 批量改动有无引入用户 AI 味。
- **回归全干净**：① 非 ★☆ 装饰 emoji=**0**（命中的 6 处 ✓✕ 全是功能符号）；② 替你=0、营销(一站直达/第一时间/打造)=0、em-dash 三连从句=0。
- **本 session 批量改动无新用户文案**：sitemap/milestone/hotStockTargets 只加逻辑+注释、无用户可见 copy（milestone caption 沿用 spanSummary 原措辞）。
- **新面（错误/AI chrome）全人味**：error.tsx「出错了 · 页面加载遇到问题，请稍后重试 · 重试」简洁专业（无「哎呀~」谄媚）；notFound「未找到」terse；interpretation-panel「解读生成中…（首次约数秒）」「解读生成失败，请稍后重试」；thesis-lens「动没动你的逻辑」；ask-jieniu「问我关于你持仓…的问题…例如：」+ 自然口吻示例问句（「最近半导体的消息动没动我的逻辑？」是**用户视角**、非 app 谄媚）、「暂时无法作答，请稍后再试」「思考中…」——全对话/功能人味、无 AI-slop。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：emoji Python 全扫 + 3 类 tell grep + error/notFound/AI-panel/ask 中文文案逐条读，均复现干净。
- 下轮维度：a（交互性/可点性，第 7 轮起）

### Run 54 — 2026-07-29 02:xx · 维度 a 交互性/可点性（第 7 轮起）
- 方法：查还没验的交互面——notifications 通知行是否可点跳目标 + /plus 定价/设置页有无不可点的 data。
- **notifications 全可点**：news 通知渲染为 `<NewsCard>`（标题→/news）；价格提醒 → `<Link href=/entity/{id}>`（page.tsx:125）；登出态→登录 CTA（href=/login，live 200 确认）。
- **/plus 无可点性 gap**：定价/功能对比页——「✓/—」是功能可用性指示（aria-hidden 装饰、非开关、正确不可点）；「升级 Plus · 即将开放」按钮**有意 disabled**（支付通道未开、非坏按钮）；页面无实体/新闻 data 待点。live 200、可见 undefined/NaN=0（全文 17 处 undefined 全在 RSC flight payload、python DOTALL 剥 script 后可见=0，sed 行级剥不掉多行 script 是假象）。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：notifications/plus 组件逐读 + 两页 live 200 + 登录 CTA + /plus 可见 undefined=0 复现。
- 下轮维度：b（显示 vs 全量/最新数据，第 7 轮）

### Run 55 — 2026-07-29 03:xx · 维度 b 显示 vs 全量/最新数据（第 7 轮）
- 方法：查还没验的两个计数——entity 页「关系」tab 计数 + 通知铃铛未读 badge（是否与列表一致）。
- **entity 关系 tab 无计数（无可错）**：`page.tsx:200` label 是「关系」（无 N，不同于「大事记 N」/「资讯 N」有计数）；且 getById 的 relFrom/relTo **无 take**（全量关系入 groupRelations）。
- **通知 badge 与 list 一致（诚实、非 over-count）**：初查 grep 疑 `unreadCount` 缺 watched 过滤→over-count，但读全过程（236-260）确认 where = `{importance≥GTE, entities.some(watched), publishedAt≥window, createdAt>seenAt}`——与 `list`（22-28：importance≥GTE + entities.some(watched) + publishedAt≥window）**同一 scope**（代码注释 L256「与 list 同一道闸门」），badge = list 内 `createdAt>seenAt` 的未读子集。badge 准确反映用户会看到的未读项，非全市场 over-count。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：entity/notifications 路由逐读，确认关系 tab 无计数 + badge 与 list 同 scope 复现（差点误报 badge over-count、读全过程证伪——纪律：flag 前读全代码）。
- 下轮维度：c（静默故障，第 7 轮）

### Run 56 — 2026-07-29 04:xx · 维度 c 静默故障（第 7 轮）
- 方法：Next 日志 + AI 功能级 + ingest 日志错误趋势 + **新角度：cron dashboard 各 cron 状态**（某 cron 翻 failing = 站点 200 也看不出的静默故障）。
- **Next 服务健康**：prod 日志 922 行、**0 错误关键词**、JWTSessionError=0、boot ✓。
- **AI 功能级**：真实 deepseek chat **200/1.53s/返「正常」**（真 LLM 延迟非吞）。
- **ingest 稳定**：错误仍 **3 条**（=run47 那批瞬时 kuaixun 502×1 + overseas skip×2、5h+ 多周期**无新增**）；report/media-refresh 在跑（hot=10/12）。
- **cron dashboard 全 ok**：**9 个 cron 全 "ok"、无 failing**（含 run44 注册的 brief-recent「解牛 AI早报brief生成(deepseek·每日)」cms4dxdbm，首次调度 fire ~16:30 07-29、此刻 04:55 未到、状态 ok）。另注：比 run44 多出 1 个别 session 加的「逻辑信号补齐(敏感度的原料)」cron，亦 ok。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：Next+ingest 日志 grep + AI 真实往返 + cron_list 状态复现。
- 下轮维度：d（覆盖缺口，第 7 轮）

### Run 57 — 2026-07-29 05:xx · 维度 d 覆盖缺口（第 7 轮）
- 方法：routine 反向 diff（每轮兜底）+ 新角度：0 新闻/0 媒体股（+ 验 run44 热门股轮扫有没有缩小媒体缺口）。
- **反向 diff 干净**：push2delay 可交易全集 5884 / seedable 正常股 5392 / DB STOCK 5500 → **正常股漏在 DB = 0**（无新 IPO 漏采）。
- **完全空白（0 新闻）= 85**：稳定（baseline 81-85）；reverse-diff 证 0 seedable 漏 → 这 85 是已存的**死壳**（ST/退/历史死码，run 12/39 死实体 backlog），非可加正常股。
- **0 媒体 = 263（改善中）**：有媒体 5237/5500；0 媒体从 baseline ~281 → **263（−18）**，run44 热门股轮扫 + media-refresh 在**缩小媒体缺口**（覆盖有增益、不只新鲜度）。剩 263 是冷门/次新股（eastmoney-stocknews 源对其无媒体报道）的**市场客观下限**、非可修 bug（已 backlog）。
- backlog 新增：无（0 新闻=死壳 backlog、0 媒体=冷尾下限，均已记）。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：反向 diff（0 漏）+ DB 0新闻(85)/0媒体(263) 计数复现。
- 下轮维度：e（坏链/404/500，第 7 轮）

### Run 58 — 2026-07-29 06:xx · 维度 e 坏链/404/500（第 7 轮）
- 方法：新角度 **tRPC 端点边缘输入健壮性**（run31 角度 + batch 改了 milestone 端点）+ 内部链接复爬 + 外链 spot-check。
- **tRPC 边缘输入全健壮（无 500）**：坏 id→**200** 优雅（getById 返 null、milestones 返空）；months>24 / months<1 / page>500 / 坏 tab 枚举 / 坏 type 枚举 / 缺必填 id → **全 400** 校验。milestone 端点（batch importance-desc 改动）对坏 id 返 200 空、越界 400——边缘输入未崩、re-sort 空数组无恙。
- **内部全绿**：核心路由 + sitemap/robots 全 200；深爬 551 条唯一内部链接（含医药+珈凯新股）**0 非 200**。
- **外链 spot-check 全 200**：holderchange（/executive/603733、001255）+ 公告（/notices/detail）+ 快讯（/a/…）均 200——run40 holderchange 修复仍 live。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：核心路由 9 + 8 个 tRPC 边缘输入 + 551 内部链接并行 + 4 外链 spot-check 复现（无 500/坏链）。
- 下轮维度：f（文案准确性，第 7 轮）

### Run 59 — 2026-07-29 07:xx · 维度 f 文案准确性（第 7 轮）
- 方法：新角度——**定性标签阈值**（把数值映射成词的 label：资讯热度/重磅密度/多视角相关 高/中/低）是否与实际数值一致（活对比热/冷实体）。
- **阈值映射清晰**：`scorecard.ts` levelOf 分位 ≥67 高 / ≥34 中 / else 低（threshold→label 由构造保证）；master-compass 相关度同理。
- **活一致性验证通过**：北方华创（热、近30日 16 条）→ 资讯热度「**高**」+ headline「资讯活跃 · 资讯热度突出」；珈凯（冷、近30日 4 条）→ 资讯热度「**低**」+ headline「覆盖平稳」。重磅密度（北方华创 1 条重磅→低）/ 多视角相关（0-1/4→低）均与数值一致。标签准确跟踪真实值、无 label≠value 错配。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：北方华创（热）vs 珈凯（冷）scorecard 标签 live 对比，热度/重磅密度/相关度标签均与数值一致复现。
- 下轮维度：g（数据新鲜度，第 7 轮）

### Run 60 — 2026-07-29 08:xx · 维度 g 数据新鲜度（第 7 轮，周三盘前）
- 方法：per-hour 聚簇 + 未来戳 + 各源 + signals 5 类 + batch 修复(report/stocknews)~1.5 天后是否仍 holding + ingest 错误趋势。
- **管线健康**：近24h 入库 2355、**24/24 小时都有写入**、未来戳=0。
- **实时源新鲜**：wallstreetcn/快讯/个股资讯 0.3h、公告 0.8h。
- **市场数据源 12-16h = 盘前正常（勿误报）**：董监高/股东增减持 12h、业绩预告 13.4h、大宗 15.5h、龙虎榜 15.9h——盘后（~17:00）发布，08:55 盘前看到的是昨日(07-28)盘后数据、今日数据待今日收盘后。niche/弃用源：集微网 19.4h（低量）、cninfo 20.9h（弃用轮转、东财公告 0.8h 已覆盖）。
- **batch 修复 holding**：券商研报 14h（run42 是 75h flat、已恢复且持续 1.5 天）、个股资讯 0.3h/近24h 910。signals 5 类全 0.3h 新鲜。ingest 错误仍 3 条（=run56、无新增）。brief cron 首次调度 fire ~16:30 今日（08:55 未到）。
- backlog 新增：无。
- 部署：**无**（investigate-only、无代码改动）。
- 自测：per-hour histogram（24/24）+ 12 源新鲜度 + signals 5 类 + ingest 日志复现。
- 下轮维度：h（空状态/边缘，第 7 轮）

### Run 61 — 2026-07-29 09:xx · 维度 h 空状态/边缘（第 7 轮）
- 方法：查还没验的 **SECTOR 板块页**边缘（稀疏/空板块）+ 临时名复查。
- **发现真边缘 bug（SECTOR 页把成员股行情当板块行情）**：旅游零售（SECTOR·2 成员）页显示行情卡「市盈率 19.04 · 市净率 2.06 · 总市值 1183 亿」——实为成员 中国中免(601888) 的行情。根因：quoteTicker 解析 `Object.values(groups).flat().find(STOCK)` 搜**全部**关系桶，对 SECTOR 抓到 members(BELONGS_TO 成分股)。板块无单一估值、不该显某成员的 P/E（房地产 0 成员→无行情对；医药成员是 COMPANY→未触发）。
- **修（安全/机械·TDD·已部署）**：抽 `resolveQuoteTicker(entity, groups)` 到 entity-graph.ts——只从 `groups.stocks`（ISSUES-out 发行股票桶）取：SECTOR/PERSON 该桶空→无行情；COMPANY→其发行股票；STOCK→自己 ticker。RED（SECTOR-成员案例返成员 ticker、期望 null）→ GREEN 6/6；page.tsx 用之替换内联逻辑。
- 验证：`build` exit0 → start-prod.sh(pid 63107)：首页 200 + CSS 7cffd1659e44ede2 200 + boot✓ + AI /models 200；**live 三类实体**：旅游零售(SECTOR) **无行情卡**、中芯国际(COMPANY) **有**(发行 688981)、韦尔股份(STOCK) **有**——修复端到端生效、COMPANY/STOCK 行情保留。
- **临时名股=0**（fix-prefixed-names 自愈）。
- backlog 新增：无。
- 部署：**是**（entity 页 + entity-graph 在 Next bundle）。
- 自测：RED→GREEN 6/6 + tsc **0**（基线 34 已被并行 session 清到 0、我 0 新增）+ vitest 116 文件 856 全绿 + 上述 3 类实体行情 live 验证。
- 下轮维度：i（去AI化增量巡检，第 7 轮末）

### 决策批量执行 — 2026-07-28 · sway「需要我决策的都按推荐现在执行掉」（非 scheduled run）
一次性清掉所有「有明确推荐、等 sway 拍板」的 backlog 项（4 项全做；仅需 sway 给方向的另列末尾）：
1. **sitemap 只收有资讯实体**（死壳 SEO，run 12/13）：sitemap.ts 加 `where:{news:{some:{}}}`；TDD 2/2；部署验证 /entity/ ~11124→**10893**、翰博高新(0新闻)排除/珈凯保留。
2. **大事记「一年脉络」修**（run 37）：milestones 改 `[{importance:desc},{publishedAt:desc}]` 取全年最重磅 200 + 取后按时间倒序展示；TDD（新增 + 更新既有测）；部署验证 **医药「覆盖 1 个月」→「13 个月」**（2025年7月→2026年7月）。
3. **report/media 热门股轮扫**（run 7）：新增 `hotStockTargets(db,k)`（近7天热度 top-K），report(+hot10)/media(+hot12) 冷尾外并入（去重、热门优先）；TDD 2/2；功能实跑 hotStockTargets 返 东方财富/宁德/长鑫/机器人 等、研报刷新 **inserted=4 新研报**；ingest-only 无需部署、下轮 ingest 自动生效。
4. **brief-recent cron 重挂**（run 20）：注册 durable hermit cron（id `cms4dxdbm0fwvpvzcxhi62c4f`，每日 ±90m，`brief-recent.ts --limit=60 --hours=30`）；注册前实跑=**本轮生成 0 条**（当前无积压，保险性质）。
- 部署：#1#2 在 Next bundle → `NODE_ENV=production npm run build` exit0（单独）→ start-prod.sh(pid 78208)：首页 200 + CSS af124f716f97af1c 200 + [boot]✓ + AI /models 200 + milestone/sitemap live 验证；#3 ingest-only；#4 cron。
- 自测：tsc 34（全旧基线、0 新增）+ vitest **114 文件 826 全绿**（新增 milestone/sitemap/hotStockTargets 测 + 更新既有 milestone 测）。
- **仍需 sway 给方向（无明确「做 X」推荐、非我能单方执行）**：美股行情/K线接入（要不要做 + 接哪个源）、催化临近语义（固定日历 vs 动态「两周内」信号）、回购/质押端点接入、notFound()→200（框架级、与性能重构冲突）、研报评级（此前 sway 暂缓）。seed-universe 常驻 cron 按 run30 推荐维持「每轮 d 顺手 diff 补」不新增。auth JWTSessionError 已确认为 AUTH_SECRET 升级预期噪声、无需动作。

### 维度 i kickoff — 2026-07-27 · 去AI化（sway 直接指派，非 scheduled run）
- 背景：sway 要求「网站整体去AI化，使 UI 文案看起来不像 AI 生成」。加维度 i 入轮换（见上方定义），并现在先做最显眼的首页登出态 hero 做示范给 sway 校准方向。
- **首页 hero 改写（before→after）**：
  - 副文 before：「解牛覆盖全 A股，**替你从每天的海量资讯里筛出真正触及投资逻辑的那几条——登录后，这里会变成你的**每日投资晨报：今天你的组合逻辑变了什么，需要复核什么。」（AI tell：替你 hand-holding + 海量资讯 filler + 破折号从句 + "这里会变成"冗余）
  - 副文 after：「A股每天上万条公告和资讯，真正动摇你持仓逻辑的没几条，解牛只盯这几条。登录后按你的自选股生成晨报：今天哪条改了你的判断、哪些要复核。」（去破折号/去替你/去海量/更具体笃定）
  - 关于卡 before：「**聚焦** A股 一手财经资讯 + **投资**大师视角解读…（东方财富·公告，**全市场实时**含正文）」 → after：「A股一手财经资讯 + 大师视角解读…（东方财富·公告，含正文）」（去"聚焦"buzzword + 去"实时"夸大[run14 flag] + 精简）
- 部署：build exit0 → start-prod.sh(pid 17513) → 首页200 + CSS 935934f1696679be=200(哈希匹配) + AI ping 200。live 实测新文案已渲染、旧 AI 文案 0 残留。
- 自测：tsc 34 + vitest 593 全绿 + 上述部署+live 验证。
- 待 sway 校准：① 力度是否合适；② section 抬头 emoji(🎯🗓️🕰️等)要不要一并去掉（最强 AI tell、但可能是有意亲和设计）；③ 要不要连续跑几轮 i 一次把全站扫完（否则按轮换 h 之后才轮到 i、较慢）。

### 维度 i 全站扫 — 2026-07-27 · sway「按推荐做，不再询问，直到做完」
- 三问我自己拍板：① 力度＝维持 kickoff 那版（简洁笃定、专业财经味）；② emoji 抬头＝全去（最强 AI tell）；③ 节奏＝现在一次扫完全站。
- **改动（~20 文件）**：
  - **emoji（14 处）**：thesis-card/my-thesis/thesis-alerts/thesis-lens(🎯)、catalyst(🗓️)、event-timeline(🕰️)、portfolio-impact(🕸️)、portfolio-changed(🐂×2)、entity 我的卡/holding-editor(📌)、price-alert/alert-protocol(🔔)、market-analysis(📈)——全部换成 `<span className="h-*w-1.5 rounded-full bg-brand">` 竖条 marker（复用站内 news-scorecard/masthead 已有的非 emoji 抬头样式）。
  - **prose**：portfolio-impact「往往被同一条逻辑牵动——顺带提醒你别漏看」→「常被同一条逻辑牵动。列出可能被带动的其它持仓，供你留意」；morning-briefing「已替你静音——宁静也是信号」→「今日无实质动态，已自动静音」；entity SEO desc 去「—— 解牛聚焦式…」尾巴；我的卡免责三连收敛；thesis-card 免责「帮你监控…非投资建议、不构成买卖依据、不预测涨跌」→「仅供监控你关注的维度；非投资建议、不预测涨跌」；discover/seo 去「一站直达/第一时间触达/私人投研工作台」；notifications 去「第一时间」；workbench/onboarding/decision-editor 去破折号从句 + 替你/帮你/为你/锚点；ecosystem「一举一动，一并纳入监控」→朴素。
  - **红线守住**：合规免责全部保留（只收敛冗余），品牌定位「私人投研 Agent」eyebrow 保留，催化日历/记分卡等事实性说明不动。
- 部署：build exit0 → start-prod.sh(pid 69914) → 首页/CSS 哈希 935934f1696679be=200 + AI ping 200 + 密钥齐全。**live 实测**：首页/个股页/发现/提醒/onboarding 5 页 **emoji=0**、新 hero 文案在线。
- 自测：tsc 34（无新增）+ vitest 89 文件 593 全绿（无测断言被改文案）+ 上述部署+live 验证。

### Run 6 — 2026-07-27 02:43 · 维度 f 文案准确性
- **发现**：产品早已从「重点覆盖热门板块（一两百只）」转向「全部覆盖 5492 只 A股」，但一整簇用户可见/SEO 文案仍写旧定位、与现实矛盾——证据(grep+线上 curl)：首页登出态 H1「不铺满全市场」+副文「解牛聚焦最热门板块里最火的股票」；发现页 metadata(title「热门板块与个股」/desc「聚焦最火赛道的核心标的」/og/twitter)；SECTOR 实体页 meta「解牛只覆盖最热门板块的核心标的」；搜索空态「解牛聚焦最热门板块的核心标的，可能暂未覆盖」；onboarding「解牛不铺全市场」+空态；`lib/seo.ts` 全站 SITE_DESCRIPTION「只覆盖最热门板块的核心个股」；hot-sector-grid 非 full 分支(现为死码但组件仍暴露该模式)。
- **修复**：把「聚焦」从『只覆盖热门股(窄宇宙)』重构为『聚焦你在乎的投资逻辑(全宇宙里的窄注意力)』——真实且不失品牌调性。改 6 文件 9 处用户可见/爬虫可见字串：page.tsx(H1+副文+注释)、discover(title/desc/og/twitter)、entity SECTOR desc、entity-search 空态、onboarding-flow(定位句+空态)、seo.ts SITE_DESCRIPTION、hot-sector-grid 死分支。均改为「覆盖全 A股 / 按行业全覆盖」口径。（残留 3 处旧措辞是代码注释+弃用/脚本路径，非用户可见，未动。）
- backlog 新增：无。
- 部署：build exit0 → start-prod.sh(pid 12155) → 首页200 + CSS f06924950b56aa3b=200 + [boot]✓密钥齐全(AI+邮件)；线上 curl 实测新文案已渲染(首页「覆盖全 A股，只把你在乎的投资逻辑盯牢」、discover「全 A股行业与个股」、半导体页 meta「解牛按行业全覆盖 A股」)、旧文案全站 0 残留(首页+discover+实体页 grep「不铺满全市场/聚焦最热门板块里最火/只覆盖最热门板块」=0)。
- 自测：tsc 34(无新增) + vitest 88 文件 584 全绿(无测断言这些字串,改前已确认) + 上述线上渲染验证。纯字串改动无单测可加(渲染验证代之)。
- 下轮维度：g（数据新鲜度）

### sway 直报 4 条 — 2026-07-28 · 只记录+定位根因（非 scheduled run）
sway 在 dashboard 报了 4 个问题并说「先记录一下」。**本轮零改动、零部署**，只做根因定位，全部落入上面 Backlog 的「★ sway 直报」小节。
- **①敏感度无实时反馈**：不是前端 bug。全库 `ThesisSignal` 仅 **11 条 / 3 个实体**，materiality `<40:10、40–59:1、≥60:0`，而档位阈值 `high=40/normal=60/low=80` → 中/低档恒 0 条、99.9% 的股列表恒空，唯一会变的 UI 就是这条列表 → 观感上「点了没反应」。根问题是信号管线没产出，次问题是没有「会提醒 N 条」这类即时计数。
- **②切 tab 弹回页首**：真凶是 `_components/scroll-reset.tsx`（监听 `searchParams` 变化就把 `#main-content` 滚到 0），`?tab=` 与 `?page=` 被一视同仁；给 tab Link 加 `scroll={false}` **修不掉**。
- **③关系大面积空**：`ecosystem` 查 `fromId=本实体 & BELONGS_TO→SECTOR`，但库里 `STOCK→SECTOR` 5356 条、`COMPANY→SECTOR` 仅 181 条 → **COMPANY 覆盖 2.4%(130/5498) vs STOCK 97.4%(5356/5500)**，公司页必空；同侪查询又限定 `from.type=COMPANY`，二次错位。另 `RELATED` 全库 **1 条**（产业链/竞对没采）。
- **④宁德时代半年报**：**采到了**（`300750` 2026-07-24 11:28 一批 12 条 PRIMARY，含《2026年半年度报告》及摘要）。是 `collapseAnnouncementBursts`(threshold=4) 折成 1 条代表，`HEADLINE_TITLE` 命中「回购」让回购公告胜出、半年报 rank 1 被折进「另有 11 份」；且半年报 importance 仅 **45**（与《总经理工作细则》同分）。坏在呈现+打分，不在采集。
- 证据方式：`node` 直连 prisma 库统计（关系组合分布 / ThesisSignal materiality 分布 / 300750 近期条目逐条打印）+ 读 `entity.ts:119-190`、`announcements.ts`、`my-thesis-card.tsx`、`scroll-reset.tsx` 源码。
- 待 sway 定：修的顺序，以及 ③ 是「查询兜一层」还是「补 RELATED 数据源」、① 是先补信号管线还是先补 UI 反馈。

### sway 直报 ⑤ — 2026-07-29 · 自选列表代码时有时无（只记录+定位，非 scheduled run）
sway 贴了侧栏「持仓与观察 · 7」截图：国盾量子/长鑫科技 标「公司」无代码，东山精密(002384)/大普微-UW(301666)/摩尔线程-U(688795)/新易盛(300502)/江波龙(301308) 标「股票」带代码。说「这个反馈也记下」。**本轮零改动、零部署。**
- **根因**：同一家公司在库里是 **COMPANY / STOCK 一对孪生实体**，而「代码」不是字段、是烙在 STOCK 名字里的字符串。实测：**STOCK 名 100% 含 `(6位代码)`（2000/2000），COMPANY 0%（0/2000），COMPANY 的 `ticker` 字段 5498 家全 null**。侧栏 `sidebar.tsx:220` 只渲染 `{e.name}` → 加的是哪一份就长哪样。
- **为什么会混**：`entity.search` 有意把 STOCK 归并到「规范 COMPANY 页」，`dedupeSearchResults` 还专门借发行股票的 ticker 来显示 → **搜索加自选得到 COMPANY（无代码）**；从发现页/板块成员/资讯实体 chip 进去则可能是 STOCK（有代码）。全站 `Watchlist` 实测 **COMPANY 15 / STOCK 5**，正好对得上截图的 2:5。
- **顺带澄清（重要，别误伤）**：资讯绑定是**双绑**的，COMPANY 那份不缺内容——抽样 6 万条 `NewsEntity`：COMPANY 28108 / STOCK 24005；国盾量子 COMPANY 128 条 vs STOCK 124 条。COMPANY 缺的只是**代码**和 **BELONGS_TO 行业关系**（后者即 ③）。
- 已并入上面 Backlog「★ sway 直报」的 ⑤，含三档修法（借 ticker 显示 / 加自选归一 / 给 COMPANY 补 ticker 字段）。
- 同步更新：① 敏感度那条经核对**已由另一 session 于 07-28 修完并部署**（spec + `patchNow` + `backfill-signals.ts` + cron 均在），Backlog 里已划掉并留档。②③④ 仍未动。

### swayfix4 run 1 — 2026-07-29 · 修 sway 直报 ④（半年报被同日公告折叠吃掉）
- **发现/复现**：300750 在 2026-07-24 11:28 一次 12 份 PRIMARY，`collapseAnnouncementBursts` 折成 1 条代表，`HEADLINE_TITLE` 命中「回购」让回购公告胜出，《2026年半年度报告》落在中性档被折进「另有 11 份」。单测复现（RED 2 条：`半年报与回购同日撞车时两条都露面`、`代表最多 2 条`）+ importance RED 2 条（`detectEventType("…2026年半年度报告")` 期望 `半年度报告`、PRIMARY 期望 75）。
- **修复**（3 处代码 + 1 个新脚本）：
  - `src/lib/announcements.ts`：`HEADLINE_TITLE` 补 `年度报告|季度报告|年报|中报|季报`；新增 `SUMMARY_MARK` 把「摘要」降到中性档（不占正文代表位）；`pickRepresentative` → `pickRepresentatives(group, max=MAX_REPRESENTATIVES=2)`——**只给实质事件加名额**（一件都没有时仍只留 1 条，避免「1 件重磅 + 十几份程序性」又变 2 条），`burstCount = n − 代表数` 记在最后一条代表上。
  - `src/lib/importance.ts`：`EVENT_WEIGHTS` 新增 `半年度报告/季度报告/年度报告 = 30`（排在 业绩快报 35 之下、复牌 30 同档），一手定期报告 45 → **75**。词条按「具体在前」排，标签取更具体的那个（半年报显示「半年度报告」而非「年度报告」）。
  - `src/app/_components/news-card.tsx`：折叠注脚从「（同一事件的程序性文件，已折叠）」改「，多为同一事件的程序性文件，已折叠」——3 件以上重磅时旧文案是断言错误。
  - **新增** `src/scripts/rescore-periodic-filings.ts`：存量补分。只碰 PRIMARY（一手公告的 eventType 本就按标题打，媒体是按标题+摘要+正文打的，用标题重算会打低 → 一条不碰）、只升不降、`where` 带 `importance < 75` 所以每次重跑只捡没达标的、天然幂等可续。实跑 **35367/35367 篇补分完毕，剩余 0**（两趟，第二趟 65 篇收尾）。
- **部署**：build exit **0** → `scripts/start-prod.sh`（pid 72397）→ 首页 200 + CSS `c80fea30f929efa2` 200（**公网**复核也 200）+ `[boot] ✓ 密钥齐全`。**功能级 AI 验证**：真实 deepseek 往返 **1328ms 返「正常」**（真延迟＝请求确实发出去了）。
- **线上定向验证**（不是随机抓股）：`/entity/<300750>?tab=announce` 与 COMPANY 页 **两页都同时出现《2026年半年度报告》和《关于回购公司股份方案的公告暨回购股份报告书》**，注脚「同日另有 10 份公告」＝12−2，与单测预期一致；`?tab=milestone` 大事记**首次出现**《2026年半年度报告》（importance 75 过重磅线的直接效果）。
- **自测**：RED（announcements 2 + importance 2 全红）→ GREEN；全量 `vitest run` **117 文件 893 全绿**；`tsc --noEmit` **0**；`next lint` 0 error。
- ⚠️ **本轮踩坑（已写进 lessons）**：`npx next lint 2>&1 | tail -12; echo $?` 读到的是 **tail 的退出码**，把一条真 error（`prefer-includes`，我写的 `/摘要/.test()`）当成通过；随后 `npm run build` 在 lint 阶段退出 1，而**失败的 build 已经就地改了 `.next`** → 线上 CSS 一度 **400**（首页仍 200，正是「curl 200 骗局」）。改成 `cmd > log; echo EXIT=$?` 后立刻定位、修 lint、重 build（exit 0）、restart，线上恢复。**管道后面的 `$?` 永远不是前面那条命令的**。

### swayfix4 run 2 — 2026-07-29 · 修 sway 直报 ③（关系 tab 大面积空）
- **发现/量化**（比 backlog 记的更糟，两种错位各打一边）：复刻现行 ecosystem 取数，对 COMPANY / STOCK 各**均匀抽样 60 个**（不是 id-asc，那会偏向扩容前那批老公司、给出 30/40「正常」的假象）——**COMPANY 板块查空 59/60**（`fromId=本实体` 查 BELONGS_TO，而行业归属几乎只挂 STOCK 那一份）、**STOCK 有板块但无同侪 52/60**（成分限定 `from.type=COMPANY`，而成分几乎全是 STOCK）。两类页面合计只有 **8/120** 渲染出完整的关系块。
- **修复**：新增 `src/lib/ecosystem-scope.ts`（新文件，避开并行 session 正在改的 `entity.ts` 主体）——
  - `identityIds(selfId, twinIds)`：公司和它发行的股票是同一个「我」，去重保序；
  - `dedupeSectors`：两份身份都挂同一板块时（那 181 条老关系）板块列表去重；
  - `selectPeersFrom(identity, members, limit)`：排除自己的**全部身份**（含「我的股票挂在别的 id 下」）→ 按发行公司归并孪生（优先 COMPANY，与 `dedupeSearchResults` 归一口径一致）→ 截断。孤儿股票按自身 id 保留。
  - `entity.ts:ecosystem` 三处最小改动：加一道 `ISSUES` 查询拼 identity；`fromId: { in: identity }`；成分 `type: { in: ["COMPANY","STOCK"] }` 并在 select 里带上 `relTo(ISSUES).fromId` 求发行公司（不额外多一次往返）。
- **前后对照（同一批抽样）**：COMPANY 完整 **1/60 → 59/60**，STOCK 完整 **7/60 → 59/60**。剩下各 1 个是无行业分类的死壳（另一条 backlog）。
- **部署**：build exit **0** → `scripts/start-prod.sh`（pid 43323）→ 首页 200 + CSS `c80fea30f929efa2` 200（公网复核 200）+ `[boot] ✓ 密钥齐全`；真实 deepseek 往返 **1719ms 返「正常」**。
- **线上定向验证**（挑扩容期入库、修复前必空的那类）：东山精密**公司页与股票页竞品完全一致**且是真同行——生益科技(600183)/深南电路(002916)/胜宏科技(300476)/沪电股份(002463)/鹏鼎控股(002938)/三环集团(300408)/生益电子(688183)/广合科技(001389)，「竞品 · 8」；宁德时代公司页「所属行业 新能源/储能/电池」+ 竞品 8。**回归检查**：SECTOR（元件）页 200 且**正确地没有**「行业与竞品」块（不重演 run 61 的板块行情 bug）。
- **自测**：新模块 RED（模块不存在）→ GREEN 9/9；全量 `vitest run` **118 文件 907 全绿**；`tsc --noEmit` 0；`next lint` 0 error（三件套都按 `cmd > log; echo EXIT=$?` 取码，run 1 的教训）。
- ⚠️ **判据踩坑（未造成故障，但差点误报）**：第一次线上断言我搜的是「所属板块/同板块/覆盖图谱」，东山精密公司页报 ✗ —— 实际是**断言写错了**：那三个词属于 `getById` 的关系桶，而 ecosystem 块的抬头是「行业与竞品」。改用正确关键词后三个页面全过。判据必须对准被改的那段代码，不能凭印象挑词。
- backlog 新增：`src/lib/ecosystem.ts` 的 `selectPeers` 已无引用（连同 `ecosystem.test.ts`），可择机清理——本轮不动，避免与并行 session 抢文件。

### swayfix4 run 3 — 2026-07-29 · 修 sway 直报 ⑤（自选列表代码时有时无）
- **发现**：代码不是字段、是烙在 STOCK 名字里的字符串（STOCK 名 100% 带 `(6位代码)`、COMPANY 0%、COMPANY 的 `ticker` 5498 家全 null）；`sidebar.tsx` 与 `/profile` 都只渲染 `entity.name` + 类型标签，于是「搜索加的」（归一到 COMPANY）没代码、「发现页/资讯 chip 加的」（STOCK）有代码。全站 Watchlist 混着 COMPANY 15 / STOCK 5。
- **修复**（取推荐的 (a) 档，显示层统一，不动实体模型）：
  - **新增** `src/lib/watch-label.ts`：`splitNameCode(name)`（尾部 `(\d{6})` 才拆——写死 6 位是为了不误伤「某某(集团)」「某某(12345)」；`-U`/`-UW` 属于名字，保留）；`watchEntityLabel(e)` → `{name, sub}`，`sub` 取 `自己的 ticker ?? 名字里的代码 ?? 发行股票的 ticker ?? 类型标签`——板块/人物/未上市公司不会留空副行。
  - `watchlist.list` / `portfolio.list`：各加 `relFrom: { where: { type: "ISSUES" }, select: { to: { select: { ticker: true } } }, take: 1 }`，在同一次查询里把发行股票的代码带回来（不多一次往返），返回值映射出 `issuedTicker`。
  - `sidebar.tsx`、`app/profile/page.tsx`：改用 `watchEntityLabel`，两处渲染口径一致（头像首字母也改用剥掉代码后的名字）。
- **真实数据冒烟**（比单测有说服力）：把新口径套到**全站 4 个用户共 20 条真实自选**上，逐条打印新旧对照——**公司/股票仍无代码的 = 0**。sway 那位用户的 7 条正是截图那批。
- **部署**：build exit **0** → `scripts/start-prod.sh`（pid 12035）→ 首页 200 + CSS `c80fea30f929efa2` 200（公网复核 200）+ `[boot] ✓ 密钥齐全`；真实 deepseek 往返 **2975ms 返「正常」**。
- **线上端到端验证**（⑤ 在登录态才看得到，所以走**项目自带的真实登录流程**：给 `VerificationToken` 播种一次性 OTP → POST `/api/auth/callback/credentials` 让**服务器自己**签发 cookie，**不手工铸 JWT**——那条路 8 种组合全 401 是有前科的）：登录 302 + 拿到 session cookie，`/profile`（服务端组件，HTML 里就有渲染结果）实际输出 **长鑫科技→688825 / 国盾量子→688027 / 东山精密→002384 / 大普微-UW→301666 / 江波龙→301308 / 新易盛→300502 / 摩尔线程-U→688795**，**7 条全带代码、0 条仍显示「公司」「股票」**。播种的 OTP 被登录消费 + 兜底删除，复验残留 `VerificationToken` 仅 1 条且是别人 7-02 的过期行（非我造成）。
- **自测**：新模块 RED（模块不存在）→ GREEN 9/9；全量 `vitest run` **119 文件 916 全绿**；`tsc --noEmit` 0（中途抓到一次漏导入，补上后归零）；`next lint` 0 error；三件套均按 `cmd > log; echo EXIT=$?` 取码。
- **未做（留档）**：孪生实体仍可各自被加自选（(b) 档「加自选归一 + 迁移已有」）、COMPANY 补 `ticker` 字段（(c) 档）。现在两份至少长得一样了，视觉不一致已消除。

### swayfix4 run 4 — 2026-07-29 · 修 sway 直报 ②（切 tab 弹回页首）· **loop 收官**
- **发现：backlog 里记的根因是错的**。原判「`ScrollReset` 监听 searchParams、把 `?tab=` 当换页」——按此修完（`shouldResetScroll` 切 tab 不复位）**真浏览器实测仍然弹回 0**；再补上 tab `<Link>` 的 `scroll={false}`（RSC 载荷里确认 `scroll\":false` 已生效）**还是弹回 0**。于是改用 CDP 逐帧采样 + 劫持 `scrollTop` setter / `scrollTo` / `scrollIntoView` 抓调用栈，才看清真因：**一次调用都没有**，而 `scrollTop` 与 `scrollHeight` 在**同一帧**里 900/8968 → 0/5295，且 `#main-content` 自始至终是**同一个 DOM 节点**。结论：切 tab 时容器子树被整棵替换，内容高度瞬时塌陷，**浏览器自己把 scrollTop 夹成 0**，没有任何脚本参与。
- **修复（三层缺一不可）**：
  - **新增** `src/lib/scroll-reset-policy.ts`：`shouldResetScroll(prev, next)`——首次挂载不动；pathname 变则复位；**tab 变则不复位**（判据只看 tab，因为 tab 链接本就回第 1 页、会顺带丢掉 `page`，用「差异参数集合」会误判）；其余 query 变化按 canonical（排序后）比较，参数顺序不影响判定。`clampScrollTarget(saved, scrollHeight, clientHeight)` 保证还原位置不超出新内容。
  - `src/app/entity/[id]/page.tsx`：tab `<Link>` 加 `scroll={false}`（关掉 Next 自己那份滚动）。
  - `src/app/_components/scroll-reset.tsx` 重写：在 `pointerdown`/`keydown`（捕获阶段）快照 `#main-content` 的 `scrollTop`——**必须在导航前抓**，等 effect 跑的时候浏览器早夹成 0 了；判定为「不复位」时，用 rAF 在 1.5s 窗口内反复把位置还回去（新内容是异步落地的），用户一动滚轮/触摸/按键就 `stop()` 收手，不跟人抢。
- **部署**：build exit **0** → `scripts/start-prod.sh`（pid 98153，`.next/BUILD_ID` 与进程启动同为 14:59）→ 首页 200 + CSS `c80fea30f929efa2` 200（公网复核 200）+ `[boot] ✓ 密钥齐全`；真实 deepseek 往返 **1661ms 返「正常」**。
- **线上端到端验证**（无头 Chrome + **公网 URL** + **真实鼠标事件**）：切 tab 基线 1232 → **1232**（URL 确认已导航到 `?tab=announce`）、切回资讯 1232 → **1232**；**回归**：换页基线 4239 → **0**（URL `?tab=announce&page=2`）、换实体页 900 → **0**。四项全过。
- **自测**：policy 单测 RED（模块不存在）→ GREEN 12/12；全量 `vitest run` **120 文件 928 全绿**；`tsc --noEmit` 0；`next lint` 0 error。
- ⚠️ **两次测试假象（都靠「换个判据」才识破，值得记）**：① 用 `a.click()` 触发导航 → **不触发 pointerdown**，快照永远是 0、还原逻辑根本没跑，测出来的「失败」是假的；改用 `Input.dispatchMouseEvent` 才是用户走的路。② CDP 鼠标事件按**视口坐标**派发，而分页链接在 y≈3488（视口只有 900）——**点了个空气**，页面压根没导航，`location.search` 还是旧的，却被读成「换页没复位」的回归。改成先 `scrollIntoView` 再按实际坐标点，四项才真实可信。**教训：断言之前先确认「那个动作真的发生了」**（本轮的锚点是 `location.search` 有没有变）。
- **验证脚本**：`scripts/_scroll-check.ts` / `_scroll-diag.ts` / `_pager-diag.ts` 为一次性诊断，验证完已删除；套路（Chrome + CDP、逐帧采样、劫持 scroll API 抓栈）与 `scripts/shot.ts` 同源，需要时照抄即可。
- **（低·清理，swayfix4 收官时顺带查到）两处已无引用的死代码**：① `src/lib/ecosystem.ts` 的 `selectPeers`（连同 `ecosystem.test.ts`）——run 2 换成 `ecosystem-scope.ts:selectPeersFrom` 后再无调用方；② `src/app/_components/my-watchlist.tsx`（`MyWatchlist`）——全仓无 import，是早期首页组件的遗留，里面的自选 chip 也还带着「有的有代码有的没有」的老渲染（`{e.name}` 直出）。两者都**不影响线上**，留着的风险是误导下一个人（我 run 3 排查 ⑤ 时就差点把它当成活的渲染点去改）。清理时机避开并行 session 抢文件。

### sway 直报 ⑥ — 2026-07-29 · 右侧卡片改成能单独上下滚（已修+已部署）
- **诉求**：sway 贴个股页截图，「右侧卡片也可以单独上下滚动」。
- **现状**：三处右栏（个股页 / 首页登录态 / 资讯详情页）都是 `lg:sticky lg:top-4 lg:self-start`，**没有高度上限**。卡片叠起来比一屏高时（个股页实测内容高 **1758px** vs 视口 1000px），sticky 只把顶部钉住，下半截够不着——必须连正文一起滚，正文就被带走了。
- **修复**（三处同一改动，纯 CSS，无逻辑）：加 `lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1`。高度预算算得准是因为**顶部 header 是 `md:hidden`**，lg 起 `#main-content` 占满 `100dvh`，减掉 `top-4` 的 1rem 与底部留白 1rem 正好。`overflow-x-hidden` 防止卡片阴影撑出横向滚动条，`pr-1` 给滚动条留位。移动端不受影响（全是 `lg:` 前缀，个股页 aside 在移动端仍是 `contents`）。
- **线上实测**（无头 Chrome 1600×1000，公网 URL）：个股页右栏 `overflow-y=auto`、`max-height=968px`、可视高 968 / 内容高 1758 → **确实可滚**；**把右栏滚到 400，正文仍停在 0**；**再把正文滚到 800，右栏仍停在 400** —— 两个方向互不牵动。资讯详情页与首页（登录态，右栏只在登录后渲染）同样已是独立滚动区，当前内容不足一屏故无需滚动。出了一张对照图：正文停在 600 不动、右栏滚到底 790。
- **自测**：`tsc --noEmit` 0、`next lint` 0 error、`vitest run` 120 文件 928 全绿、build exit 0、`start-prod.sh`（pid 52266）、公网 CSS `6c48815223bb6197` 200（哈希随新 Tailwind 类变了，正是改动生效的旁证）、真实 deepseek 往返 1463ms 返「正常」。
- ⚠️ **判据踩坑（第三次同类）**：首轮验证用 `document.querySelector("aside")` 取右栏，结果拿到的是**左侧导航**（`sidebar.tsx` 也是 `<aside>`，且 `overflow:hidden`、高度正好等于视口），报「右栏不是滚动区」。改用 `aside[class*="lg:sticky"]` 才对上。**选择器也要对准被改的那段代码**，别用会撞名的宽泛选择器。

### sway 直报 ⑦⑧ — 2026-07-29 · 切 tab 慢/卡 + 关系 tab 空（部分修，慢的根因如实留档）
- **⑧ 关系 tab「没有数字也什么内容都没有」——✅ 已修**。根因：该 tab 只铺 `entity.getById` 的**原始边**，而原始边少得可怜——实测 **三一重工 COMPANY 出边只有一条** `ISSUES→三一重工(600031)`，STOCK 那份也只有「所属板块 + 发行公司」两条。而真正有内容的「所属行业 + 8 个同行竞品」（run 2 修好的 ecosystem）**一直只画在右栏**，tab 里根本看不到。修：新增 `src/lib/relation-view.ts:ecosystemPeers(groups, ecosystem)`——板块与竞品取 ecosystem（它按「公司↔发行股票」两个身份查，覆盖率 97%），其余原始边照旧，原始边里的 `sector/members` 因为已被 ecosystem 更好地表达而不再重复；`total` 是去重后的关联对象数，直接当 tab 计数。TDD 4/4。**线上实测**：三一重工公司页/股票页都变成 **「关系 10」** + 所属行业 工程机械 + 同行竞品 恒立液压/徐工机械/中联重科/杭叉集团/浙江鼎力/铁建重工/柳工/艾迪精密。
- **⑦ 切 tab 特别慢特别卡 —— 只做到「点击立刻有回应」，真正的提速没做**。先量后改：无头 Chrome + 公网实测，点下去到新 tab 真正上屏 **464–1153ms**，而这段时间 **主线程长任务 0 个**——不是卡在渲染，是**一次完整的服务端往返**：全站 `force-dynamic`，切 tab 等于把个股页（最重的一页）整个重渲一遍。叠加两件事让它「像点死了」：tab 导航不换 segment 所以 Next 不亮 `loading.tsx`；而 sway 直报 ② 刚把「切 tab 弹回顶部」修掉，之前那一跳好歹是个有反应的信号。
  - **已做**：tab 条抽成 `src/app/_components/entity-tabs.tsx`，给加载中的那个 tab 就地加转圈——实测点击后 **5–11ms** 出现。另把 `scroll-reset` 的还原循环从「死等 1500ms」改成「高度稳定两帧即收手 / 上限 600ms」，避免新 tab 更短时空转 1.5 秒、每帧强制回流。
  - **试过但没留**：悬停预取（`prefetch={warm ? true : undefined}`）。两条路径各量一遍——悬停后 1153/969/518ms，不悬停 596/971/464ms，**耗时区间完全重叠、看不出增益**（350ms 的悬停窗口盖不住 ~1s 的服务端渲染）。没有实测支撑就不留，白搭一份服务端渲染。
  - **未做（需 sway 定）**：真正提速要动结构——① 把列表拆进自己的 Suspense 段，让外壳/右栏先出、只有列表转圈；② 或者干脆客户端切 tab（一次取齐几个 tab 的数据）。都是较大改动，且 ② 对 公告115/研报17 这种长列表要掂量载荷。
- **部署**：build exit 0 → `start-prod.sh`（pid 44578）→ 首页 200 + CSS `e1cb117e1d685aa0` 200（公网复核 200）+ `[boot] ✓ 密钥齐全`；真实 deepseek 往返 1812ms 返「正常」。**自测**：`vitest run` 121 文件 **932 全绿**、`tsc --noEmit` 0、`next lint` 0 error。
- ⚠️ **量测踩坑**：加了 tab 转圈之后，原来那个「`#main-content` 首次 DOM 变化」的指标失真了——最先变的是**转圈本身**（5–11ms），把「内容到屏」量成了「点击有反应」，两件事差一个数量级。换成轮询「哪个 tab 变成 `aria-current`」才对得上。**指标要盯住被测的那件事，别被自己新加的 UI 抢答。**

### sway 直报 ⑨ — 2026-07-29 · 问解牛重做：显眼入口 + 持续对话 + SSE 流式（已上线）
三项均由 sway 拍板：入口 **D（保留悬浮钮、做大做醒目）**、持久化 **B（存库、一条连续线、跨设备）**、流式 **B（真流式 + 逐段合规护栏）**。规格见 `docs/specs/2026-07-29-ask-jieniu-conversation.md`。
- **数据模型**：新增 `AskMessage`（userId/role/content/createdAt，`@@index([userId, createdAt])`）。一位用户一条连续线，**不做多会话**（悬浮面板里塞会话列表是负担）。纯新增表，`db push`。
- **上下文预算**：历史**存全量、只带最近 6 条**进提示词（`lib/ask-history`）。`recentTurns` 还有一条讲究：**截断后不以 assistant 开头**——半截的答话当上文会让模型以为自己刚说过什么、接着往下编。
- **流式**：新增 route handler `app/api/ask/stream`（POST + `text/event-stream`；`EventSource` 不能 POST，所以客户端用 fetch + ReadableStream）。新增 `server/llm-stream.ts` 走 OpenRouter `stream:true`——**刻意开新文件**，不动 `llm.ts`/`ai.ts` 那一票调用方。响应头带 `X-Accel-Buffering: no`，否则隧道后面的 Caddy 会把流攒成一整块再发。
- **合规（最关键的一处）**：`isCompliant` 是**纯正则扫描**、不依赖全文完整性，所以可以对**已生成的前缀**反复跑。抽出 `lib/ask-guard.ts:createStreamGuard`——逐块喂入、命中即锁死并 abort 上游、收尾整段再扫一次兜底；**判废不入库**。抽成状态机是为了能单测：红线内容没法指使模型去说，只能靠单测把「红线被拆在两块之间也要抓到」这类行为钉死，而 route handler 用的就是它——**测的和跑的是同一份代码**。
- **去重**：`ask.answer` 里那 ~70 行记忆取数抽到 `server/ask-memory.ts`，流式与单轮共用一份真相。
- **客户端**：`ask-jieniu.tsx` 重做成对话（消息列表 + 流式追加 + 清空 + 记为投资笔记）。**打字机效果就是流本身**，不额外做逐字动画。SSE 帧解析抽 `lib/sse.ts`（半截帧必须留到下一轮，这是流式解析最容易丢字的地方），带单测。
- **入口**：悬浮钮 `px-4 py-3` → `h-14` 胶囊、文字 15px、加描边与更实投影。
- **线上端到端实测**（真登录 + 公网）：① **真流式**——单次回答 **339 块增量**，首块 4.5s、末块 68s，分批到达；② **正常提问 3/3 全通过**，含免责声明；③ **多轮上下文**：第二轮问「刚才那条再展开说一点」返回 1048 字，落库计数逐轮 +2；④ **合规拦截端到端命中**：事件序列 `delta/blocked`，该轮**只落库用户那一句**（判废不入库）。
- **自测**：新增单测 4 组（ask-history 6 / ask-prompt 4 / sse 7 / ask-guard 6）；全量 `vitest run` **125 文件 955 全绿**；`tsc --noEmit` 0；`next lint` 0 error；build exit 0；`start-prod.sh`（pid 72475）；公网 CSS `1534c2b2d99aef43` 200。
- ⚠️ **两点如实留档**：① 首轮 e2e 撞上 OpenRouter **429 上游限流**，`error` 事件与日志都正常работали（没有裸 catch，日志留下了原因）——不是代码问题，重跑即过。② 合规护栏**会拦真实回答**：有一次模型在正常提问下写出了价格点位，被「价格点位」规则拦下。这是**设计如此**（铁律②不给目标价/点位），与单轮那条路的行为一致、非回归；3/3 的抽样说明不会误伤日常提问，但样本小，后续留意。
- **未做**：多会话/会话列表、重新生成、移动端独立对话页（YAGNI，规格里已写明）。

### sway 直报 ⑩ — 2026-07-30 · 个股发现里名称点不动（已修+已部署）
- **发现**：`sector-rotation.tsx` 的「个股发现」只把 `s.code` 包成 `<Link>`，`s.name` 是纯 `<span>`——**点名字没反应**。而且名称本身还带着代码（`德明利(001309)`），跟前面单独显示的 `001309` 重复。顺带查到同一文件的「主力资金前三」也是纯文本 `leaders.map(l => l.name).join("、")`，同样点不动。
- **修复**：抽 `StockLink`（同文件内的小组件）——代码与名称同在一个链接里，名称用 `lib/watch-label:splitNameCode` 剥掉重复的 `(6位代码)`，拿不到实体 id 就退化成纯文本、**绝不产生 `/entity/null` 死链**；链接用 `HoverPrefetchLink`（个股页重，悬停才取完整载荷）。「个股发现」与「主力资金前三」都换成它。router 侧给 `leaders` 补上 `entityId`，复用已有的 `entityIdByCode` 表，不多查一次。
- **TDD**：`sector-rotation.test.tsx` 新增 4 条（RED 3 条 → GREEN）：名称必须落在指向该实体的 `<a>` 之内、名称不再重复代码、无 id 时不产死链、代表股可点。全量 **135 文件 1045 全绿**。
- **线上实测**（公网 /discover）：`/entity/...` 链接里**同时含代码与中文名的条目 234 个**（`001309德明利`、`600702舍得酒业`…）；截图确认「个股发现」代码+名称整条变成可点的琥珀色、`(001309)` 重复已消失，「主力资金前三」（长鑫科技、通富微电…）也变成链接。
- **注**：页面上仍有 189 处 `名称(代码)` 形态，都在「全部覆盖」浏览网格那类**没有单独显示代码**的列表里——那里代码是名字里唯一的出处，保留是对的，不是漏改。
- **部署**：`tsc` 0 / `next lint` 0 error / build exit 0 / `start-prod.sh`（pid 96809）/ 公网 CSS `ccd0d2d681bebad9` 200 / `[boot] ✓ 密钥齐全`。

### sway 直报 ⑪ — 2026-07-31 · 翻页弹回页首 + tab 条 sticky（已修+已部署）
- **诉求**：①「股票详情页下方几个 tab，翻页的时候页面又会滚到最上面」②「给这里的 tab 设置 sticky，滚到这里后 tab 应该黏在页面最上方便于切换」。
- **①的来龙去脉**：7-29 修 sway 直报 ② 时，我把判据定成「切 tab 不复位、**其余照旧**」——翻页归在「其余」里，仍回整页顶部。当时那是有意保留的（「换页从头看」是 ScrollReset 当初被加进来的原因），但 tab 条在页面很下方，翻一页就得重新往下滚一大段。现在细化成**三档**：`scrollAction(prev, next) → none | tabs | top`（`lib/scroll-reset-policy`）——切 tab `none`（留原地）、翻页 `tabs`（回**列表顶部**）、换实体页/改搜索词 `top`（回整页顶部）。**判据顺序有讲究：先判 tab 再判 page**——tab 链接本就回第 1 页、会顺带丢掉 `page`，先判 page 会把「切 tab」误判成「翻页」（已用单测钉住）。
- **②的实现**：`entity-tabs.tsx` 的 tab 条加 `sticky top-0 z-20 bg-canvas`（`top-0` 相对 `#main-content` 这个滚动容器；**必须不透明底色**，否则滚过去的卡片会从字缝里透出来）。不用负 margin 铺满宽度——tab 条在左栏里，拉出去会盖到右栏。
- **两者的接缝**：翻页要滚到 tab 条，就**不能拿 tab 条自己算偏移**——它是 sticky 的，滚过之后 `getBoundingClientRect()` 给的是「吸住后的位置」（永远贴容器顶），算出来的 delta 恒为 0、页面纹丝不动。所以在 tab 条**前面**放一个零高度、不 sticky 的锚点 `#entity-tabs-anchor`，量它才是真实文档位置。
- **TDD**：`scroll-reset-policy.test.ts` 从布尔断言迁到三档动作，新增「翻页滚到 tab 条」「第 1 页→第 2 页（原来没有 page 参数）同样滚到 tab 条」「切 tab 顺带丢掉 page 时按切 tab 处理」三条；14 条全绿。全量 **159 文件 1453 全绿**。
- **线上实测**（无头 Chrome + 公网 + 真实鼠标事件，5 项全过）：① tab 条 `position=sticky top=0px z=20 bg=rgb(244,242,236)`（不透明）；② `scrollTop=2000` 时 tab 条距容器顶 **0px**、而锚点已滚到 **-312px**（证明确实滚过去了、是真黏住而非恰好在位）；③ **翻页后 `scrollTop=1688`（>0 即没回整页顶部）、锚点距顶 0px**、URL `?tab=announce&page=2`；④ 回归：切 tab 仍 1257 → 1257 原地不动；⑤ 回归：换实体页仍 → 0。
- **部署**：`tsc` 0 / `next lint` 0 error / build exit 0 / `start-prod.sh`（pid 18366）/ 公网 CSS `cab4d148cb964f3d` 200 / `[boot] ✓ 密钥齐全`。
