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
