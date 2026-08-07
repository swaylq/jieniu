# 解牛 — 数据源参考（2026-07-01 实测）

所有端点均在 2026-07-01 实际发起 HTTP 请求核实过，非凭记忆。字段/请求头/参数里的坑都标了出来——**照抄即可用**。

抓取原则：
- **多数源直连 JSON API**，不走公共 `rsshub.app`（已被 Cloudflare 墙，见坑 #1）。
- **PDF 附件统一从 cninfo 取**（交易所 PDF 主机反爬不一致）。
- **抓取节点放大陆出口或加代理**（多 CN 主机对非大陆 IP 慢/半通，部分仅 HTTP）。
- 每个 fetcher 上线前**按本文的请求模板自测一遍**。

---

## MVP 起步 6 源

### 1. 巨潮资讯网 cninfo — 一手 ⭐ 基石
- **列表**：`POST http://www.cninfo.com.cn/new/hisAnnouncement/query`
  - Header：`Content-Type: application/x-www-form-urlencoded; charset=UTF-8` + UA（**Referer 非必需**）
  - Body：`pageNum, pageSize, column=szse|sse, tabName=fulltext, plate=shkcp(科创)|szcy(创业)|shmb|sz, stock=<secCode,orgId>, category=<code>, seDate=2025-01-01~2026-07-01, isHLtitle=true`
  - 返回：`announcements[{ secCode, secName, orgId, announcementTitle, announcementTime(ms), adjunctUrl }]`
- **PDF**（无反爬）：`http://static.cninfo.com.cn/` + `adjunctUrl`
- **orgId 解析**：`POST .../new/information/topSearch/query` body `keyWord=<code>&maxNum=10`；深市另有 `GET .../new/data/szse_stock.json`（`sse_stock.json` 是 404）
- **半导体**：`plate=shkcp` 单拉科创板（中芯/韦尔/澜起/中微/沪硅…）
- **去重键**：`adjunctUrl`（唯一）　**节流**：~1–2 req/s

### 2. 东方财富快讯 — 媒体
- `GET https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&pageSize=20&req_trace=1`（**无鉴权**）
- 半导体筛：`search-api-web.eastmoney.com/search/jsonp?...keyword=半导体`；板块 `push2.eastmoney.com/...fs=b:BK1036`
- **去重键**：news id / url　**时效**：实时 7×24，5000 条滚动

### 3. 深交所互动易 irm.cninfo — 准一手 ⭐ 差异化核心
- `POST https://irm.cninfo.com.cn/newircs/index/search`
  - Header：`Content-Type: application/json;charset=UTF-8` + Referer + UA
  - Body（**必须 JSON**）：`{"keyword":"半导体","pageNo":1,"pageSize":20,"searchTypes":[1]}`（`searchTypes` **必须是数组**）
  - 返回：**一次即含问答对** —— `mainContent`(问) / `attachedContent`(董秘答) / `stockCode` / `secid` / `companyShortName` / `trade` / `attachedPubDate(ms)` / `qaStatus`(2=已答)
- **坑**：用 form 编码会**静默忽略过滤**、返回近 2 万条洪流——必须 JSON body。读取无需登录。
- **去重键**：问答 id / (stockCode+attachedPubDate+hash)

### 4. 集微网/爱集微 — 媒体（原创一手行业报道）
- **全文 RSS**：`GET https://www.ijiwei.com/api/rss/hbb`（`content:encoded` 带全文+图，零解析成本）
- **避开** JSON `/api/`（MD5 签名 + robots `Disallow:/api`）
- **去重键**：guid / link

### 5. 华尔街见闻 live — 媒体
- `GET https://api.wallstreetcn.com/apiv1/content/lives?channel=a-stock-channel&client=pc&limit=20`（**无鉴权**）
- `a-stock-channel` 每条带 `symbols[]`（如 `688981.SS` 中芯国际）+ `related_themes` —— **按股票代码精准挂载半导体**
- robots 显式放行 ClaudeBot/GPTBot；镜像 `wallstcn.com`（`api-one.wallstreetcn.com` 已死）
- RSSHub（自托管）：`/wallstreetcn/live/a-stock`　**去重键**：content id

### 6. TrendForce 集邦 — 准一手（价格/市场原始数据）
- **现货价**：`GET https://www.trendforce.cn/price/dram/dram_spot`（返 HTML 表：高/低/均 + 日涨跌）
- **新闻**：`/presscenter/news/*`（SSR 全文）或自托管 RSSHub `/trendforce/cn/presscenter/news`
- 深度报告/历史数据 Gold 会员墙；免费层够用。**去重键**：news url

---

## 扩展源（MVP 后按需接）

- **芯东西**（智东西芯片）：`GET https://zhidx.com/wp-json/wp/v2/posts?categories=2660`（WP 开放，`content.rendered` 全文；**RSS 已坏 500，用 wp-json**）
- **芯智讯**：`GET https://www.icsmart.cn/wp-json/wp/v2/posts`（**必带浏览器 UA，空 UA→403**）
- **上证 e 互动**（科创股 Q&A）：`GET https://sns.sseinfo.com/ajax/feeds.do?page=1&type=11&pageSize=10&lastid=-1&show=1`（`lastid` **必须小写**，大写→500；Referer `qa.do` + `X-Requested-With`；返回 HTML 片段）
- **上交所公告**（科创）：`GET https://query.sse.com.cn/security/stock/queryCompanyBulletinNew.do?...`（**必带 `Referer: https://www.sse.com.cn/`**；PDF 从 cninfo 取）
- **深交所公告**（创业）：`POST http://www.szse.cn/api/disc/announcement/annList`（**必带 `X-Request-Type: ajax`** + Referer；PDF 从 `disc.static.szse.cn`，`www.szse.cn` 主机 403）
- **北交所**：`POST https://www.bse.cn/info/listse.do`（**必须 HTTPS** + `X-Requested-With`；JSONP 剥壳）
- **证监会**：`GET http://www.csrc.gov.cn/searchList/{channelId}?_isAgg=true&_isJson=true&_pageSize=18&page=1`（`_isJson=true` 是 JSON 开关；行政处罚 `channelId=17d5ff2fe43e488dba825807ae40d63f`）
- **财联社电报**（A股最快）：`GET https://www.cls.cn/v1/roll/get_roll_list?app=CailianpressWeb&os=web&rn=20&sign=<sign>`（旧 `/nodeapi/telegraphList` 已死；`sign = MD5(SHA1(参数按 key 字母序排+URL编码))`；或自托管 RSSHub `/cls/telegraph` 内部自算 sign；IP 限流狠→代理池）

### 人物动态 / 董监高变动（一手）
- 任免公告：复用巨潮 `hisAnnouncement/query`，`searchkey=辞职/聘任/独立董事/高级管理人员`（限定半导体自选池）
- 深市持股变动：`GET http://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1801_cxda&TABKEY=tab1&PAGENO=1`
- 沪市持股变动：`GET http://query.sse.com.cn/commonQuery.do?sqlId=<ID>&...`（**必带 Referer `http://www.sse.com.cn/`**，否则 403）
- 高管演讲/活动：无一手结构化源，从集微网/TrendForce/快讯按人名关键词过滤
- 业绩说明会/路演：上证路演中心 `roadshow.sseinfo.com/roadshowList.do`；全景路演 `rs.p5w.net/index/homepController/getRoadshowRecommend`

---

## 2026 年的坑（务必遵守）

1. **公共 `rsshub.app` 已不可用于生产**：所有路由对 curl/服务端一律 403 / Cloudflare 挑战，只有真浏览器能过。要用 RSSHub 必须**自托管**（Docker + `ACCESS_KEY` + `PROXY_URIS` 轮换 IP + Redis 缓存 + Puppeteer）。
2. **cninfo 的 RSSHub 路由已死**（迁 Hono 后只剩在未挂载的 `routes-deprecated/`）→ 巨潮/证监会一律直连 JSON API，别信旧教程。
3. **财联社改版**：旧 `/nodeapi/telegraphList` 返 Next.js HTML 壳；活端点是 `/v1/roll/get_roll_list` + sign。
4. **交易所 PDF 主机反爬不一致**：`static.sse.com.cn` 有阿里 `acw_sc__v2` JS 挑战（curl 取不到沪市 PDF）→ **PDF 统一从 cninfo 取**；深市 PDF 只能走 `disc.static.szse.cn`。
5. **半导体源域名陷阱**：`semiinsights.com` 已过期（正确 = `semi-insights.com`，带连字符、仅 HTTP）；CSIA = `web.csia.net.cn`（`csa.org.cn` 无关）；TrendForce 用 `.cn`（`cn.trendforce.com` DNS 失败）；SEMI 用 `www.semi.org.cn`（`www.semi.org` 被 CF 墙）；芯思想**无网站**（仅公众号）。
6. **请求头/参数隐形坑**：互动易 form 编码静默失效（用 JSON + 数组）；上证 e 互动 `lastid` 小写；SSE query 系列缺 `www.sse.com.cn` Referer→403；SZSE annList 缺 `X-Request-Type: ajax`→拒；icsmart 空 UA→403。
7. **"一手"成色分级**：集微网/芯东西 = 原创首报（可信一手媒体）；**半导体行业观察、与非网 = 洗稿/编译/转载重**——按低可信媒体打标，勿当一手。
8. **抓取方式反直觉**：集微网 JSON `/api/` 有签名+robots 禁→用其 RSS；与非网 wp-json 401+RSS 冻结→走 sitemap；芯东西 RSS 坏→用 wp-json。
9. **地域限制**：多 CN 主机对非大陆 IP 慢/半通，部分仅 HTTP→抓取节点放大陆或加代理。
10. **价值在线（ir-online）** `/app/activity/*` 有 AES 签名 + 需先拿 `activityId`，最脆——MVP 跳过，用上证路演中心/全景路演替代。

---

## 2026-07-24 实测补充（数据源调研 loop run 1）

11. **巨潮 orgId 必须实解，不能猜**：`topSearch` 返回的是 `gshk0000981` 这类字符串（不是纯数字）。orgId 填错时 `hisAnnouncement/query` 照返 **HTTP 200 + `announcements: []`**，静默失败不报错。自测脚本里把「200」当成功会直接骗过你。
    - 实解模板：`POST http://www.cninfo.com.cn/new/information/topSearch/query` body `keyWord=688981&maxNum=10` → `[{"code":"688981","orgId":"gshk0000981","zwjc":"中芯国际"}]`

12. **巨潮 `announcementTime` 约 90% 只有日期精度**：实测 2026-07-24 全市场 szse 90 条里 **82 条是当日 `00:00:00` CST**，仅约 9% 带真实时分秒；定向查 688981 近两月 **20/20 全是 00:00**。`storageTime` 字段全为 `null`。
    - 对照实验已排除「定向查丢精度」：同一条公告（`adjunctUrl` 匹配）在全市场查与定向查里时间戳完全一致 → 是公告本身分两类。
    - **后果**：直接拿它当 `publishedAt`，今早发的公告会被打成今天 00:00，在时间倒序流里沉到当天所有快讯下面。要真实披露时刻得跨源对账（如东财公告同条）。

13. **东财快讯 `stockList` 不是新闻主体股**：格式 `["150.516390","150.010806"]`（`<market>.<code>`）。实测 100 条中 47 条有值，但抽查全是 **ETF / 基金 / 指数 / BK 板块**——「高新兴中标信阳项目」挂的是两只 ETF，不是高新兴(300098)。**别拿它当 `entityHints`**，会重演「研报绑板块」那个坑。现有实现忽略它是对的。

14. **华尔街见闻 `symbols[]` 是全池最好的挂载字段，但稀疏**：`{key:"002197.SZ", name:"证通电子"}`，规范代码 + 名称，另有 `related_themes` / `fund_codes`。实测**仅 10/100 条非空**——够用但不能当唯一挂载路径，要「有 hints 走 hints、没 hints 回退文本匹配」。`related_themes` 是主题标签不是主体，**别挂**。

15. **集微网唯一可用 feed 落在 robots `Disallow: /api` 底下**：`https://www.ijiwei.com/api/rss/hbb`（laoyaoba.com 同 robots）。`/rss`、`/feed` 都是 SPA 壳（返 200 但给 HTML）。灰区——feed 本身就是给机器读的格式，但 robots 字面覆盖了它。低频抓（feed 只存 10 条、日更约 1.4 篇，6 小时一次足够）。

16. **RSS 的 `pubDate` 也可能包 CDATA**：集微网返回 `<![CDATA[Thu, 23 Jul 2026 15:51:00 GMT]]>`。写 RSS 解析器时**每个字段都要过 `cdata()`**，不能只处理 title/content——漏一个日期字段，`new Date()` 解析失败兜底成当前时刻，整个源的发布时间就废了（见台账 run 1 的 P1 bug）。

---

## 2026-07-24 实测补充（loop run 2 · 东财系）

17. **东财公告有两个时间字段，只有 `display_time` 能用**：
    - `GET https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=50&page_index=1&ann_type=A&client_source=web&f_node=0&s_node=0`
    - `notice_date` = `2026-07-24 00:00:00` —— **50/50 条全是日期精度**，等于没有时刻
    - `display_time` = `2026-07-24 11:43:04:552` —— **毫秒精度，50/50 条都有**
    - 跨源对账（14 只股、命中同条 9 条）：巨潮带真实时刻的 4 条与 `display_time` **中位仅差 58.5 秒**，方向一致（巨潮更早、东财转发晚 ~1 分钟）→ **`display_time` 是可靠的披露时刻代理**
    - ⚠️ **解析陷阱**：`new Date("2026-07-24 11:43:04:552")` ✅ 能解析（V8 容忍空格式）；`new Date("2026-07-24T11:43:04:552")` ❌ Invalid。毫秒前是**冒号不是点**，别顺手把空格换成 `T`「规范化」。空格式按**本机时区**解析——换 UTC 机器会整体偏 8 小时，稳妥写法显式补 `+08:00`。

18. **东财公告自带源侧事件分类 `columns[]`**：98/100 条有值，`column_name` 形如 `发行保荐书` / `借贷` / `调研活动` / `法律意见书` / `首发提示性公告` / `其他增发事项公告`。比关键词猜标题准，可替代/增强 `detectEventType(title)`。`codes[]` 则 100/100 带规范 `stock_code` + `short_name`（A/B 股会给多个）。

19. **东财研报接口是活的，别被个股查询误导**：
    - 全市场（**不带 `code` 参数**）：`GET https://reportapi.eastmoney.com/report/list?cb=x&qType=0&pageSize=20&pageNo=1&beginTime=2026-06-24&endTime=2026-07-24` → 近 30 天 `hits=393`，最新为**当日** —— 增量抓取应走这个，别逐只查
    - 个股查询 `hits=0` 往往是**这只股真没新研报**（宁德时代 2026-04-23 之后三个月空窗），不是接口滞后
    - `publishDate` 只有日期精度（`2026-04-23 00:00:00.000`）
    - 历史深度：中芯国际 `hits=79` 可回溯到 2022-02-14（≥3 年）

20. **东财个股资讯是关键词搜索，不是个股绑定**：`search-api-web.eastmoney.com/search/jsonp` 按股票**名称**搜，返回的 `cmsArticleWebOld` **不含股票代码**——`entityHints` 完全靠调用方硬绑，搜「中芯国际」可能返回只提了一嘴中芯国际的文章。噪音也最高：实测 104 条过管线只剩 68 条（65%），拦截主力是 ETF 营销 18 条 + 综述稿 18 条。`mediaName` 字段 100% 有值（第一财经/证券时报等）。

21. **robots 补充**：`np-anotice-stock.eastmoney.com/robots.txt` 返回 200 但**内容为空**（无限制）；`search-api-web` / `reportapi` 均 404。三家 G1 均通过。

---

## 2026-07-24 实测补充（loop run 3 · 行情/估值）

22. **行情主源新浪 `hq.sinajs.cn`（GBK）**：`GET https://hq.sinajs.cn/list=sh600519`（**必带 `Referer: https://finance.sina.com.cn`**）。cn 股字段布局：`名称,今开,昨收,现价,最高,最低,…,[30]日期,[31]时间`。响应带真实行情时刻（如 `2026-07-24 11:30:00`）。批量：`list=sym1,sym2,…`（实测一次 40 个正常）。指数/港美股也走它但**字段布局各不相同**（见 `quote.ts:parseSinaIndex` 注释）。

23. **行情备源腾讯 `qt.gtimg.cn`（GBK）**：`GET https://qt.gtimg.cn/q=sh600519`（Referer `https://gu.qq.com`）。`~` 分隔。与新浪现价**逐笔完全一致**（实测 12/12 Δ=0.000%，精确到分）。**完整字段含估值**：`[3]`现价 `[38]`换手率% `[39]`市盈TTM `[44]`流通市值(亿) `[45]`总市值(亿) `[46]`市净率 —— **可作 push2 估值的兜底**（单位「亿」需 ×1e8 对齐 push2 的「元」）。

24. **🔴 `push2.eastmoney.com` 从本节点不可达（估值源）**：`push2.eastmoney.com/api/qt/stock/get`（估值 f116/f117/f162/f167/f168）**TCP 能连、随即被对端关闭**（curl HTTP 000、node `UND_ERR_SOCKET`/"other side closed"）。https/http/带UA/去fields/3 重试全失败。
    - **主机级、非东财整体**：兄弟主机 `push2his.eastmoney.com`（K线）HTTP 200 正常，`np-anotice-stock` 也正常。疑 push2 这台做了 TLS 指纹/地域过滤。
    - **生产影响**：`fetchValuation` 打 push2 → 拿不到 → catch 静默返 null → 估值卡在线上为空。**不崩但功能哑火，被 catch 吞掉无告警**。
    - **对策**：估值改用腾讯 qt.gtimg 兜底（见 #23），它本就是现价备源。

25. **新浪 K线 `quotes.sina.cn`（历史深度）**：`GET https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=sh600519&scale=240&ma=no&datalen=1000` → `[{day,open,high,low,close,volume}]`。`datalen` 线性伸缩，1000 可回溯约 4 年（2022-06）。

26. **`tickerToSymbol` 漏北交所 `9` 号段**：`920045` 这类北交所新号段返回 null（函数只认 `8/4` 开头归 bj）。北交所股拿不到行情。补 `9` 前需先确认新浪 `bj920xxx` symbol 是否被接受（**未测，别拍脑袋改**）。

27. **行情源可校准 entity.name 陈旧**：新浪/腾讯返回的 `name` 是最新的（如 603501 已是「豪威集团」而非库内旧名「韦尔股份」）。可用行情 `name` 定期刷新库内 entity.name。

---

## 2026-07-24 实测补充（loop run 4 · 资金面，方向轮换 #1）

28. **东财数据中心统一入口** `datacenter-web.eastmoney.com/api/data/v1/get`（**这台可达，push2* 系列间歇封锁**）：
    - 通用参数：`reportName=<RPT_名>&columns=ALL&pageNumber=1&pageSize=50&sortColumns=<字段>&sortTypes=-1`（-1 降序 / 1 升序）
    - Header：真实浏览器 UA + `Referer: https://data.eastmoney.com/`
    - 按个股过滤：`filter=(SECURITY_CODE="688981")` **URL 编码**；融资融券的代码字段名是 `SCODE` 不是 SECURITY_CODE
    - 返回：`{success, result:{pages, data:[…]}}`；报表名错时 `success:false, message:"报表配置不存在,XXX"`（HTTP 仍 200）→ **别只看状态码**
    - robots：`/robots.txt` 返 JSON 报错（无 robots 限制）

29. **资金面 4 张可用报表**（全 T+1，收盘后更新）：
    | 用途 | reportName | 排序字段 | 关键字段 |
    |---|---|---|---|
    | 龙虎榜个股明细 | `RPT_DAILYBILLBOARD_DETAILSNEW` | `TRADE_DATE` | `EXPLANATION`(上榜原因) `BILLBOARD_NET_AMT`(净额) `BUY_SEAT_NEW/SELL_SEAT_NEW`(席位) `D1..D30_CLOSE_ADJCHRATE`(后续涨跌) |
    | 融资融券个股明细 | `RPTA_WEB_RZRQ_GGMX` | `DATE` | `SCODE` `RZYE`(融资余额) `RQYE`(融券余额) `RZRQYE`(合计) `RZYEZB`(融资余额占比%) `RZMRE3D/5D/10D` |
    | 大宗交易明细 | `RPT_DATA_BLOCKTRADE` | `TRADE_DATE` | `DEAL_PRICE` `PREMIUM_RATIO`(折溢价%,负=折价) `BUYER_NAME/SELLER_NAME`(营业部) `DEAL_AMT` |
    | 股东户数(最新) | `RPT_HOLDERNUMLATEST`（历史 `RPT_HOLDERNUM_DET`） | `END_DATE` | `HOLDER_NUM` `HOLDER_NUM_CHANGE` `HOLDER_NUM_RATIO`(环比%) `AVG_HOLD_NUM` |
    - 🔴 **不存在的报表名（别再试）**：`RPT_RZRQ_LSHJMX` / `RPT_MARGIN_DAILY` / `RPT_RZRQ_STOCK` / `RPT_RZRQ_LSHJ`
    - 数字自洽（实测恒等式 10/10）：龙虎榜 `NET=BUY-SELL`、两融 `RZRQYE=RZYE+RQYE`
    - 历史极深：龙虎榜到 2004、两融到 2010、大宗到 2000
    - 覆盖：两融标的约 3000 只，覆盖库内热门股 96%；龙虎榜/大宗是事件型（触发才有）

---

## 2026-07-24 实测补充（loop run 5 · 产业链价格，方向轮换 #2）

30. **新浪期货实时**（产业链大宗价格，与现有行情源 `hq.sinajs.cn` 同基建同 GBK 处理）：
    - `GET https://hq.sinajs.cn/list=nf_LC0,nf_SI0,nf_PS0`（**Referer `https://finance.sina.com.cn`**），`nf_<品种>0` = 主力连续
    - **产业链品种映射**：碳酸锂 `LC`(锂电/新能源/汽车) · 工业硅 `SI`+多晶硅 `PS`(光伏) · 铜 `CU`/铝 `AL`/镍 `NI`(有色/正极) · 金 `AU`/银 `AG`(银浆) · 螺纹 `RB`/铁矿 `I`(黑色)
    - **字段布局**（44 字段，GBK）：`[0]名称 [1]时间HHMMSS [2]开 [3]高 [4]低 [8]最新价 [10]昨结 [13]持仓 [16]品种 [17]日期`。涨跌幅=(最新−昨结)/昨结
    - 秒级实时（盘中），G2 10/10 p95 205ms
    - 日 K：`GET https://stock2.finance.sina.com.cn/futures/api/jsonp.php/x/InnerFuturesNewService.getDailyKLine?symbol=LC0`（新品种回溯到上市日，如碳酸锂 2023-07）
    - ⚠️ **只覆盖材料驱动型板块**（光伏/锂电/新能源/汽车/有色约 4/15 热门板块），对 AI/算力/半导体/光模块/机器人/医药/白酒/银行/券商无关——**定向接入，别当通用源**

31. **东财期货 `push2.eastmoney.com/api/qt/clist`**：首探 200（872 合约）但随即间歇 `UND_ERR_SOCKET`——push2 系列对本节点间歇封锁。**同数据用新浪，别依赖 push2。**

32. **产业链现货价（生意社 `100ppi.com`/`sci99.com`、上海有色 `smm.cn`）**：主站可达但**返 HTML 无干净 JSON**，需抓取解析；`price-datacenter.smm.cn` fetch failed。半导体/面板/存储/硅料**现货**价（futures 够不着的部分）留待专门一轮做 HTML 抓取。

---

## 2026-07-24 实测补充（loop run 6 · 一致预期，方向轮换 #3）

33. **业绩预告 `RPT_PUBLIC_OP_NEWPREDICT`**（东财数据中心，一手法定披露）：
    - `GET .../api/data/v1/get?reportName=RPT_PUBLIC_OP_NEWPREDICT&columns=ALL&pageNumber=1&pageSize=50&sortColumns=NOTICE_DATE&sortTypes=-1`
    - 关键字段：`PREDICT_TYPE`(预增/略增/扭亏/减亏/续亏/预减/略减/续盈) `ADD_AMP_LOWER/UPPER`(净利增幅区间%) `PREDICT_AMT_LOWER/UPPER`(净利金额区间,元) `CHANGE_REASON_EXPLAIN`(变动原因) `NOTICE_DATE`(日期精度) `REPORT_DATE`(报告期)
    - H 回溯 2003，财报季当天更新；类型↔增幅方向自洽 27/30
    - ⚠️ **同股多条**（修正稿）：按 `(SECURITY_CODE+REPORT_DATE)` 代码侧去重留最新 NOTICE_DATE；`filter=(IS_LATEST="1")` **返空不可用**
    - ⚠️ 业绩预告标题已被东财公告源抓入 → 接入须跨源去重，或定位为「给已有预告补结构化字段」

34. **一致预期 `RPT_WEB_RESPREDICT`**（东财数据中心，卖方聚合，**需合规脱敏**）：
    - `GET .../reportName=RPT_WEB_RESPREDICT&columns=ALL&pageNumber=1&pageSize=50`；按股 `filter=(SECURITY_CODE="300750")`
    - 合规保留：`RATING_ORG_NUM`(覆盖机构数) `RATING_BUY_NUM/ADD_NUM/NEUTRAL_NUM/REDUCE_NUM`(评级家数) `EPS1..4`+`YEAR1..4`(预测EPS趋势)
    - 🔴 **铁律②丢弃**：`DEC_AIMPRICEMAX/MIN`(目标价)——不存不展示
    - 覆盖：全市场 ~1500 只（仅卖方覆盖的股），命中库内热门股 50%；H 未测
    - **预期差用法**：与业绩预告 `ADD_AMP` 配对，共识买入多 vs 公司预告下滑 = 背离信号（实测宁德时代 26家买入 but 略减-11%）

35. **业绩快报 `RPT_FCI_PERFORMANCEE`**（一手，未深测，端点备用）：实际 `BASIC_EPS` `TOTAL_OPERATE_INCOME` `PARENT_NETPROFIT` `YSTZ`(营收同比) `JLRTBZCL`(净利同比) `NOTICE_DATE`。

---

## 2026-07-24 实测补充（loop run 8 · 海外/映射，方向轮换 #5）

36. **台股月营收 TWSE OpenAPI**（半导体链先行指标，官方干净 JSON，全球可达）：
    - `GET https://openapi.twse.com.tw/v1/opendata/t187ap05_L`（上市；无鉴权）→ 1082 家数组
    - 字段：`公司代號 公司名稱 產業別 營業收入-當月營收(千元) 營業收入-去年當月營收 營業收入-去年同月增減(%) 累計營業收入-當月累計營收 資料年月`
    - ⚠️ **日期是民國年**：`資料年月=11506` 表示民國115年6月=2026-06；`出表日期=1150717`=2026-07-17。入库转公历（+1911）
    - ⚠️ **仅当月快照**，历史月营收需 MOPS `mopsov.twse.com.tw/mops/web/ajax_t21sc03`（POST，跨境间歇，本机不稳）
    - 用法：TSMC(2330)/联发科(2454)/日月光(3711) 月营收同比 → A股半导体链景气**先行指标**（间接映射，定向用）

37. **SEC EDGAR 申报数据**（美股供应链财报日历，官方全球可达）：
    - `GET https://data.sec.gov/submissions/CIK{10位补零}.json`（**UA 必须带联系邮箱**，如 `jieniu-research research@example.com`，否则可能被限）
    - 返回 `filings.recent.{form[], filingDate[], primaryDocument[]}` —— 申报类型+日期数组。英伟达 CIK=0001045810
    - `H` 极深（几十年全申报史）；`efts.sec.gov` 全文搜索端点参数难调（本轮 500），优先用 submissions API
    - 用法：英伟达/AMD/美光财报日 → A股算力/存储链「关注」标记（极间接，很低优先级）

38. **海外映射源的通病**：不挂 A股个股，挂外国实体，须过人工供应链映射才到 A股，只沾半导体/算力/消费电子少数板块 → 按关联广度门控（评分卡 §八）一律**定向/边缘**，别当通用源。新浪不供台股（`rt_tw2330` 返空）。

---

## 2026-08-03 实测（接入财联社电报 + 金十快讯）

39. **财联社电报的 sign 算法与端点（旧教程全失效）**：活端点 `GET https://www.cls.cn/v1/roll/get_roll_list?app=CailianpressWeb&os=web&rn=50&sign=<sign>`；`sign = MD5(SHA1(参数按 key 字母序拼成 "k=v&k=v"))`，实测有效（`errno:0`）。签名错返 `{"errno":"10012","msg":"签名错误"}` 但 **HTTP 仍是 200** —— 只看状态码会被骗，必须显式判 `errno`。旧 `/nodeapi/telegraphList` 返 404 的 Next.js 壳。**不需要代理池**：连打 8 次全 200、80–350ms，没遇到限流。

40. **财联社 `rn` 上限是 50，超了静默返空**：`rn=100` / `rn=200` 照返 `errno:0`，但 `data.roll_data` 是**空数组**。又一个「200 + 空」的静默失败形状。

41. **财联社翻页是死的**：`last_time` 参数不起作用——连翻 8 页拿回 240 条，**去重后只有 30 条**（同一批）。只能靠高频轮询覆盖：`rn=50` 覆盖约 2.3–2.6 小时，ingest 30 分钟一轮绰绰有余；但**间隔一旦拉长到 2 小时以上就会静默丢消息**（`fetched` 仍是 50，指标上完全看不出来）。

42. **财联社 `stock_list` 不是「本条的主体」，是「本条提到的股票」**：字段长得很像权威个股归属（给 `sh603986` 真代码 + 简称，跟东财快讯那个全是 ETF 的 `stockList`（见 §13）完全不同），但实测 50 条的扇出分布是 **`{0:45, 6:1, 7:1, 8:3}` —— 没有任何一条挂 1~2 只**。挂了股的 5 条全是「主力资金监控」「涨跌停盘点」这类罗列式综述。**别当 entityHints 无脑用**，会一条绑 8 家公司污染自选早报。判断一个「像是权威绑定」的字段能不能用，**要看扇出分布，不看命中率**——17% 的命中率全部来自综述。

43. **财联社要挡 `【盘中宝】`/`【电报解读】`**：VIP 荐股引流体裁，标题是钩子且**刻意不点名公司**（「这家企业拥有在手订单」），正文在付费墙后。既无信息量，体裁本身也撞产品的合规红线（只做逻辑/影响面，禁买卖建议）。实测 50 条里 4 条。另外正文取 `brief` 不取 `content`——**`content` 是 API 截断过的（约 60 字），`brief` 才是全文**。

44. **金十两个端点，选 `flash_newest.js`**：
    - `GET https://www.jin10.com/flash_newest.js` —— 裸 curl 就通（无需 header），**一次 50 条、覆盖约 45 分钟**，代价是要从 `var newest = [...];` 的 JS 壳里剥 JSON
    - `GET https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1` —— 标准 JSON，但**一次只给 21 条（9~27 分钟）**，要 `max_time` 翻页（`end_time` 无效）才够 30 分钟一轮，还得带 `x-app-id: bVBF4FyRTn5NJF5n` 这种迟早会变的硬编码 ID
    - ⚠️ 覆盖窗口只比 ingest 间隔（30 分钟 + 5 分钟 jitter）多 10 分钟余量，密集时段会丢。实现里加了窗口自检 `warnIfWindowTooShort`。

45. **金十 `channel` 参数是摆设**：试了 `-8200 / 1 / 2 / 3 / 5` 五个值，返回**完全一样**。别指望用它筛 A 股。

46. **金十对 A 股的价值密度低，定位是喂宏观层不是补个股**：实测只有约 20% 跟 A 股沾边，主体是全球宏观/商品/外汇/海外股市，且**一条个股绑定都不给**。正好补「今日复盘」国际·国内那两层。三类必须在源内筛掉：`type=2`+`tag=VIP`+链到 `xnews.jin10.com`（自家付费引流）、`type=1`（经济数据日历，只有 `actual/consensus` 数字没有可读标题）、**英文版重复条**（同一条中英双推，实测 9 条里 4 条是英文版 → 按「标题含 CJK」筛）。日产约 1000 条，只留 `important=1`（约 30%）压到跟其他媒体源同量级，否则会淹掉纯时间倒序的首页「最新」流。

### 2026-08-03 接入后测评 → 加噪音过滤（§47–50）

47. **财联社全频道流对 A 股的有效率只有约 26%**：接入当天对在库 27 条逐条肉眼复核，只有 7 条（收评、国内期货、港股存储概念、个股业绩、铠侠诉讼等）对 A 股投资者有价值；其余是海外行情碎讯 9 条、民生/灾害/社会 4 条（牛蛙抗生素超标、新疆高温预警、四川地震、马杜罗狱中发声）、商品报价 4 条。**这些会以 30 分基线进首页「最新」——那条流是纯时间倒序、不看 importance，稳态下噪音会占到两成**，所以必须在入库前挡。落地为 `isClsNoise`（6 条判据 + 标题护栏），实测 50 → 31 条，海外噪音占比 14.8% → 4.3%，实体绑定率 25.9% → 39.1%。

48. **行情类判据必须先命中「海外市场标识」，还要排除「国内标识」——两道都缺过就会误杀**：第一版只认「指数 + 涨跌」，把 **A 股收评**（「收评：科创50指数低开低走跌超5%」）和**国内宏观指标**（「上海出口集装箱结算运价指数」）一起杀了；补上海外标识后，「上海出口集装箱结算运价指数（**欧洲**航线）」又因为「欧洲」二字被判成海外。**地名出现 ≠ 这条属于那个市场**。最终判据是 `FOREIGN_MARKET && !DOMESTIC_MARKET`。恒生/港股刻意划归国内侧（跟 A 股联动紧密）。两次误杀正则单测全绿，**都是逐条肉眼复核抓出来的**。

49. **财联社 `level` 加红分级值得接进 importance**：实测 50 条分布 `{C:45, B:5}`，A 更稀有。B 级是「TrendForce：三季度 PC DRAM 价格环比涨 15~20%」「8月3日涨停分析」「收评」「多晶硅涨停」——确实是重磅，不接的话它们跟「水库泄洪」同为 30 分基线。落地为 `RawNewsItem.importanceFloor`（A→70 / B→60，runner 里 `Math.max` 只抬不压）。

50. **「零 A 股关联的海外事件」会被事件词典误判成重磅**：「普睿司曼与安科签署收购协议…交易完成后 Atkore 将退市」被 `detectEventType` 抓到「退市」（45 分事件权重）+ MEDIA 10 分底，**拿了全场最高的 75 分**进重磅流。`EVENT_WEIGHTS` 的语义是「A 股公司发生了什么」，套在海外交易上就是这个后果。当前解法是在源内按「海外并购」判据挡掉；更根本的修法（零 A 股绑定时事件分打折）影响全部 12 个源，未做。

51. **金十 `flash_newest.js` 的覆盖窗口在真实负载下会掉到 25 分钟**：上线首轮自检就报警（「仅 25 分钟 < 35 分钟」），不是理论风险。该端点固定 50 条且**没有翻页参数**，密集时段会静默丢消息（`fetched` 照样是 50）。解法是窗口不足 45 分钟时用备用端点 `flash-api.jin10.com` + `max_time` 往前补最多两页，实测取回条数 5 → 10 条翻倍。
