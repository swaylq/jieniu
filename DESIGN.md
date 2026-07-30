# 解牛 Design System

> 品牌合约（brand contract）。**任何人/任何 agent 改 UI 前先读这份，改完回来对照。**
> 单一事实源：色彩与字体的真值在 `src/styles/globals.css` 的 `@theme`；可复用样式常量在
> `src/app/_components/section-head.tsx`。本文件解释**为什么**和**什么时候用**——那部分代码里没有。

---

## At a glance

解牛是**私人投研工作台**，不是资讯流 App。气质要「冷静、克制、有编辑感的专业工具」——
像一份你信得过的研究简报，而不是一个抢眼球的行情软件。

暖色皮肤：**近黑暖墨 + 暖米画布 + 白卡**。整屏唯一常驻的深色区域是**左侧工作台侧栏**，
它不随明暗模式翻转——始终是深色，像工作台的台面。内容区永远是浅色纸感画布。

密度偏紧：这是给人**每天反复扫读**的工具，不是落地页。宁可信息密一点，也不要空得像营销页。

---

## Identity color system

三类颜色各司其职，**不许混用**：

### 1. 品牌琥珀 `--color-brand: #f5a623`

品牌身份与**唯一强调色**。`--color-brand-dark: #d98c00` 仅用于 hover 加深。

**铁律：一屏之内琥珀只服务「一个焦点」。**
琥珀用来回答「这屏我最该看哪儿」。如果一屏出现几十处琥珀（每个 chip 的数字都染色），
它就不再是强调色，只是一种底噪——层级被稀释，重点反而消失。

- ✅ 该用：主 CTA、当前选中的导航项、未读/已触发标记、分区强调条、焦点环
- ❌ 别用：列表里每一项的计数、每个 chip 的数字、大面积背景、正文
- 计数/热度这类**重复出现的数值**一律走 `text-muted` / `text-faint`；
  只有「本组第一名」这类真正的极值才允许琥珀。

**一句话判定（机械执行，别凭感觉）：**

> 这个元素**每条列表项都会渲染**吗？
> **是** → 走中性（`bg-line/60` + `text-muted` / `text-ink`，hover 再转琥珀）。
> **否**（条件触发、单次出现、激活/选中态、未读标记）→ 可以琥珀。

已按此收敛过的地方：板块个股热度（只留第一名）、每日速览序号与标签、催化剂日期块、
生态覆盖实体 chip、投资逻辑/我的逻辑的维度徽标与左边框、事件时间线维度徽标、逻辑异动维度徽标。

刻意**保留**琥珀的地方（都符合上面的「否」）：激活的 tab / 选中项 / 收藏态、未读「新」标记与高亮环、
主 CTA 与登录按钮、侧栏「+」、分区强调条、`FollowUpBadge` 的 accent 态、催化剂「临近」、
时间线 `hot` 重磅项、成对出现的「市场共识 vs 主要分歧」「催化剂 vs 证伪」对比卡。

### 2. 涨跌语义色 `--color-up` / `--color-down`

**只用于价格与涨跌**，绝不用于其他语义。红涨绿跌（A股习惯）。

色盲模式 `.cb` 把它重映射为**橙涨蓝跌**（对红绿色盲可分辨）——只动涨跌色，其余不变。
所以：**任何涨跌都必须走 `text-up`/`text-down` 变量，不许硬编码红绿**，否则色盲模式失效。

### 3. 中性墨阶

`--color-ink`（正文/标题）→ `--color-muted`（次要信息、时间、来源）→ `--color-faint`（最弱、计数）。
面：`--color-canvas`（页底暖米）→ `--color-surface`（白卡）→ `--color-surface-2`（卡内分区）。
分隔：`--color-line`。

侧栏自成一套（不随明暗翻转）：`--color-sb` / `sb-2` / `sb-ink` / `sb-muted` / `sb-faint` / `sb-line`。

暗色模式是**深藏蓝**（Midnight Blue，非纯黑）：`.dark` 覆盖同名语义变量，
`text-ink`/`bg-surface`/`border-line` 全自动翻转——**所以永远用语义类，别写死颜色**。

---

## Brand mark & avatar

**徽标只有一个形**：金牛座意象的「琥珀锥形月角 + 头盘」，深底板 + 琥珀发丝环。
几何与配色的单一事实源是 `src/lib/brand.ts`（`MARK_CRESCENT` / `MARK_HEAD` / `PLATE_SOLID` /
`BRAND_AMBER` / `RING_OPACITY`）；UI 侧走 `_components/logo.tsx` 的 `LogoMark` / `Logo`，
静态资产（favicon / PWA 图标 / apple-icon / OG 图）跑 `npx tsx scripts/gen-brand-assets.ts`
从同一份常量生成。**站内 logo 与 favicon 必须逐像素一致**，改色只改那几个常量、两边同时生效。

- ❌ 不许再出现：emoji 牛、「牛」字方块、页面里自己画一份牛头路径
- 为什么是抽象月角+圆盘而不是具象牛头：具象牛头缩到 18px（侧栏 / tab 条 / favicon）会糊成花瓶状；
  纯几何形到 16px 仍认得出。且「金牛」在 A 股语境本就是牛市。
- **全链路纯色，不许用 `url(#gradientId)`**：同名 defs 只解析文档序最前那一个，而桌面侧栏在移动端
  是 `display:none`（不进渲染树），于是移动端顶栏徽标会渲染成空方框（已踩）。
- **光栅化必须透明底**（生成脚本已带 `--default-background-color=00000000`）：底板是 `rx=116`
  圆角，圆角外会露页面底色；默认不透明白 → favicon 带一圈白角，与站内透明角的 SVG 不一致（已踩）。
- `apple-icon` / `icon-maskable` 是**满幅无圆角无描边环**（`bleed`）：iOS 主屏与 PWA 规范都自己套
  蒙版，且 iOS 不认透明（透明区合成成黑）。这是平台要求，不是形状漂移。

**用户头像**走 `_components/user-avatar.tsx` 的 `UserAvatar`（侧栏账号块 / 我的组合 / 设置共用）：
按邮箱稳定散列取一组深色渐变、`rounded-full`、发丝环 + 轻投影，白字在每个色上都 ≥5.5:1。
**头像不用琥珀**——琥珀是唯一强调色，一屏只服务一个焦点，那个焦点是徽标，不是天天挂着的头像。

---

## Typography

两套字族：

- `--font-sans`（Geist + PingFang SC）——**界面与正文的默认**
- `--font-display`（宋体系衬线）——**只给页面级大标题**（`<h1>` masthead / hero）

衬线只在 display 层出现，给「研究简报」的编辑感与权威感；正文、按钮、标签一律无衬线，
保证密集扫读的清晰度。**不要把 `font-display` 用在正文、按钮、chip 或分区小标题上。**

尺度（刻意偏紧，传达「专业工具」）：

| 用途 | 尺寸 | 类 |
|---|---|---|
| 页面主标题 h1 | 24px（大屏 30–32px） | `displayCls` |
| 分区标题 h2 | 16px bold | `SectionHead` |
| 卡片标题 | 15px semibold | `text-[15px] font-semibold` |
| 正文/摘要 | 14px | `text-sm` |
| 元信息（来源·时间·标签） | 12px | `text-xs` |
| 最弱（角标·计数） | 10–11px | `text-[11px]` / `text-[10px]` |

**所有金融数字加 `.tabular`**（等宽数字），否则列表里数字跳动、无法纵向比较。

---

## Shell & layout

三段式外壳（`src/app/layout.tsx`）：

```
[深色侧栏 桌面固定]  →  [内容列 flex-1，内部 main 居中收敛]
                         移动端：顶部 header + 底部 TabBar
```

- 内容列统一用 `mx-auto max-w-2xl p-4 lg:max-w-4xl`（详情页可到 `lg:max-w-6xl` + 右栏）
- 移动端底部有 TabBar，内容需留 `pb-[calc(4rem+env(safe-area-inset-bottom))]`
- 刘海屏/home 指示条：`viewportFit: cover` + `env(safe-area-inset-*)`

### 换页手感（别拆掉这三件）

线上跑在 rathole 隧道后面，一次往返光网络就 ~150–250ms，全站页面又都是 `force-dynamic`。
实测公网「点击 → 新内容上屏」曾是**中位数 481ms 且每次闪骨架屏**；下面三件把它压到 ~80ms：

1. **主导航 `<Link prefetch>`**（侧栏 5 项 + 移动 TabBar 4 项）：预取**完整**载荷，把那次往返挪到
   点击之前。个股行**不加**——自选几十只，全量预取等于替用户拉一遍整个组合。
2. **`next.config.js` 的 `experimental.staleTimes.dynamic: 30`**：Next 15 该值默认 **0**，等于刚
   prefetch 回来的载荷也不复用、每次换页都重问服务端。没有这条，第 1 件基本白做。
   写操作后面都跟 `router.refresh()`（绕过此缓存），所以不影响数据新鲜度。
3. **`src/app/template.tsx` + `.jn-page-in`**：150ms 淡入 + 6px 上移，盖住内容跳变。
   `template.tsx` 每次导航重新挂载，动画天生每页跑一次、零 JS。

配套：侧栏导航项内的 `NavSpinner`（`useLinkStatus`）只在**冷缓存 / 慢网**那段窗口出现
（实测点击后 ~80ms 现身）；路由一提交到 loading 边界 `pending` 就转 false，交给该段骨架屏。
平时看不见 ≠ 死代码。

### 个股页（全站最重的一页）另外两条

4. **外部行情不许挡主内容**：`entity/[id]/quote-card.tsx` 是独立 async 组件 + `<Suspense>`。
   那三个 fetch 打新浪 / 腾讯 / 东财，`no-store`、各 130–200ms、超时上限 6s，而东财对本机是
   间歇封锁的。拆开后服务端**外壳 8–13ms 就出流**，行情卡 ~200ms 自己补齐（原来整页卡到 278ms，
   东财一抽风就更久）。**别把它 inline 回 page.tsx。**
5. **取数只许一道波**：page.tsx 里是 `auth()` → 单个 `Promise.all`（13 个查询）。原来是四道串行波
   （DB → 外部行情 → 单独 signals → 用户态查询），首尾相接。新查询请加进那个 `Promise.all`，
   别在后面另起 `await`。
6. **重链接用 `HoverPrefetchLink`**（`_components/hover-prefetch-link.tsx`）：个股页 RSC 载荷
   ~100KB、新闻详情 ~20KB，而一屏可能挂几十条，不能像主导航那样进页面就全量预取；改成悬停 /
   聚焦才取。实测公网——个股页：直接点 494–768ms，**先悬停 300ms 再点 36–142ms**；新闻详情：
   直接点 429–762ms，**悬停后 7–155ms（多数 10–21ms）且不再闪骨架**。人从悬停到点击本来就有
   200–400ms，正好把那次往返藏进去。

   **它是两档，不是开关**：悬停前给 `undefined`（Next 默认：预热路由 chunk + loading 边界，很便宜），
   悬停后才升到 `true`（完整载荷）。**不许写成 `prefetch={false}`** —— 那会把默认那档也关掉，
   "没悬停直接点"（键盘 / 触屏 / 鼠标直接落点）反而比普通 `<Link>` 更慢，踩过：新闻卡从首页
   直接点一度 953ms。

   已用在：侧栏持仓、自选、今日变化、机会雷达、我的组合（→个股页）；`NewsCard` 标题、解牛早报、
   资讯时间线、提醒中心、事件时间线、信号日志、生态覆盖（→新闻详情）。**没覆盖**的次级入口
   （个股页内关系 chip、命令面板、资讯页实体 chip）仍是普通 `Link`，要提速照同一模式换。

7. **每个重页面都要有形状对得上的 `loading.tsx`**：新闻详情原先没有自己的，回退到根
   `app/loading.tsx`——那是一张**列表**骨架（大标题 + 搜索框 + 一串卡片）。点开一篇文章却闪出
   假列表，形状完全不对。现在 `news/[id]/loading.tsx` 按真实版式摆（返回 → 元信息行 → 大标题 →
   正文 → 右栏）。改版式时骨架要一起改。

**验证要在公网跑，不能只看 localhost** —— 本机直连时同样的请求只要 2–130ms，完全测不出这个问题。
`npx tsx scripts/measure-nav.ts` 量服务端渲染耗时；端到端手感必须用真浏览器打 `jieniu.swaylab.ai`。

---

## Spacing · radius · elevation

- **间距 4px 基准**。组件内紧（`gap-1.5`/`gap-2`/`p-4`），区块之间松（`mb-4`/`mb-6`/`space-y-3`）
- **圆角**：卡片 `rounded-2xl`（新闻卡）/ `rounded-xl`（一般卡、输入框）；
  药丸与头像 `rounded-full`；卡内小 chip `rounded-lg`。**同层级不要混用**
- **投影**：只用 `shadow-sm`；hover 可到 `shadow-md`。**不用重投影**——纸感靠边框
  `border-line`，不靠阴影堆叠

---

## Components（共享常量，别各写各的）

全部在 `src/app/_components/section-head.tsx`：

| 常量 | 用途 |
|---|---|
| `displayCls` | 页面级 h1（衬线 display） |
| `SectionHead` | 分区标题 + hint + 右侧动作 |
| `chipClass` | 实体药丸（发丝边框，hover 转琥珀） |
| `primaryBtn` | 主按钮（近黑药丸 / 暗色反白） |
| `brandBtn` | 品牌实心按钮（琥珀，如登录提交） |
| `fieldCls` / `fieldClsSm` | 输入框（focus 琥珀环） |

新增共用样式**加进这个文件**，不要在页面里复制一份变体——样式漂移是这个项目已经出过事故的地方。

---

## 硬约束（踩过坑，别再犯）

1. **`NewsCard` 的根元素就是 `<li>`** —— 必须直接放进 `<ul>`，
   **不要再包一层 `<li>`/`<div>`**。`<li>` 嵌 `<li>` 是非法 HTML，浏览器会强行闭合外层并把卡片
   重新挂到上层容器，导致卡片逃出内容列、撑满整宽。未读态走 `unread` 参数，不要自己包裹。
2. **绝对定位的滑块 knob 必须显式 `left-*` 锚定**，再用 `translate-x-*` 滑动。
   `<button>` 带 UA 默认 `text-align:center`，Tailwind v4 preflight 不重置它，
   `left:auto` 的静态原点会被居中到轨道中点而非左缘 → 整体右移、滑块出轨。
3. **涨跌一律用 `text-up`/`text-down` 变量**，不许硬编码红绿（否则色盲模式失效）。
4. **焦点可达**：全站 `:focus-visible` 有琥珀描边（`globals.css` `@layer base`）。
   自定义控件不要 `outline: none` 了事。
5. **尊重 `prefers-reduced-motion`**：已全局关动效，新加动画别绕过它。
6. **横向不许溢出**：`body` 有 `overflow-x: hidden` 兜底，但组件自身也别撑破容器。

---

## 部署（UI 改动同样适用）

`npm run build` **会就地重写 `.next`**——那就是线上那份。所以：
**build 之后必须 restart**（两步分开跑，别用 `;` 串），否则改动过的 CSS/chunk 会返回 400，
线上无样式裸奔而 HTTP 仍是 200。验证要看**当前 HTML 引用的 CSS 哈希是否 200**，不是看页面 200。
详见 `evolution/lessons.md`。
