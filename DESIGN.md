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
