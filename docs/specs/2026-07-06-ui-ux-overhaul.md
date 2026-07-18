# 解牛 UI/UX 大改造（loop `uiux` 锚点）

> 目标：把解牛从「能用」做成**像一个成熟产品**。PC + 移动端双端都要经得起截图审视。每轮拿真实登录截图（PC 1440×900 + 移动 390×844）对照改，改完再截图自证。

## 缘起（sway 2026-07-06 指示）
1. **PC / 移动端 UI+UX 都要登录看截图去改**——「现在右边滚动都很奇怪」。
2. **登录之后没有跳转**；**没有完善的账号体系**，不让用户设置密码。
3. 整体 UI/UX 要像**更成熟的产品**。

## 已确认的问题（首轮 audit）
- **MarketStrip 横向溢出**：行情条是不换行的横排，PC 端近乎全宽贴边、移动端右侧被裁切/横向滚动——极可能就是「右边滚动很奇怪」。→ U-1 先修。
- **登录 = 邮箱 OTP（Credentials/JWT）**，User 表**无 password 字段**；登录页虽有 `returnTo`/`postLoginRedirect`，但用户反馈「登录后没跳转」（需现场复现：可能 `router.push`/session 刷新时序、或落在看不出登录态的页）。
- 账号能力缺失：无密码登录、无设置/改密、无统一账号设置页（设置零散在 sidebar/profile）。

## 方法（每轮都这么做）
- **截图工具**：`scripts/shot.ts`（零依赖 CDP 驱动系统 Chrome，自带登录）。
  `env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx scripts/shot.ts <path> <out.png> [WxH] [--login=email] [--full] [--dark]`
  - PC：`1440x900`；移动：`390x844`。登录用 `--login=swaylq0913@gmail.com`（真实用户，仅播种/消费其 OTP token，无害）。
  - `--full` 整页长图；`--dark` 深色模式。**改完必须前后对照截图并 Read 查看**。
- **双端**：每个改动都要看 PC + 移动两版，别只顾一端。
- **铁律仍适用**：颜色红/绿只给真实价格涨跌，其余用 amber/灰；合规不荐股/不点位/不承诺收益；AI/Code 边界；省 token。
- **npm 陷阱**：本机 `NODE_ENV=production`，`npm install` 会漏装 devDeps。要装依赖必须 `NODE_ENV=development npm install --include=dev`。
- **构建/部署/自测**：`SKIP_ENV_VALIDATION=1 NODE_ENV=production npm run build` 过 eslint；`lsof -ti:3838|xargs kill`；`secret exec ALI_KEY ALI_SECRET OPENROUTER_API_KEY -- env NODE_ENV=production PORT=3838 MAIL_FROM="解牛 <noreply@mail.auramate.net>" ALI_REGION=cn-hangzhou nohup npm run start > /Users/mac/jieniu-prod.log 2>&1 & disown`；curl 本地 + jieniu.swaylab.ai 200。

## 🎯 Backlog（loop 逐项做，第一个未打勾优先）

- [x] **U-1 应用外壳 & 滚动修复**：✅ 根因=MarketStrip 是 `overflow-x-auto` 的不换行横排，移动端 5 指数装不下→右侧硬裁到半个数字、丑陋横滚（=用户说的「右边滚动怪」）。修：①MarketStrip 改 `relative` 卡片内 `no-scrollbar snap-x scroll-px-4` 横滑（隐藏滚动条 + 吸附）+ 移动端右缘 `from-surface` 渐隐遮罩（提示可滑、裁切收干净；桌面 `sm:hidden` 全展开不显）；②globals 加 `body{overflow-x:hidden}` 全局兜底——任何页面内容都不再把整页横撑出滚动条 + `.no-scrollbar` 工具类。自测:build 过、部署 200、PC 首页(5 指数全展开+行情仅供参考，无滚动条)/移动首页(渐隐横滑干净)/个股移动(壳无溢出、未被 guard 误裁)截图前后对照确认。shell 本身(sidebar sticky h-screen + body 滚动 + 移动 header/tabbar)是标准正确结构，仅 strip 有 bug。发现页由全局 guard 兜底。
- [x] **U-2 登录后跳转修复**：✅ 根因=OTP 成功后旧代码 `router.push(target)` **紧跟** `router.refresh()`——refresh 竞态打断 push，且对存量用户还有 `/login→/onboarding→/`(onboarding 见有自选股即 redirect 首页)双跳，client 软导航扛不住→「登录后没跳转/不像登录了」。修：改 `window.location.assign(postLoginRedirect(returnTo))` **硬跳转**，整页导航让服务器读新 session 并干净处理 onboarding→首页重定向。顺带把登录页从「顶部贴边裸表单」重做成**居中品牌卡**(LogoMark+标题+副文案+验证码步骤+重新发送/换邮箱+登录中/跳转中态+错误红条+返回首页)。自测:build 过、部署 200、**真实表单 e2e**(CDP 驱动 邮箱→发码→填码→登录)得 `{finalPath:"/onboarding",leftLogin:true,stillOnLoginForm:false}`——登录后确实跳转；登录页 PC+移动截图确认成熟居中。
- [x] **U-3 账号体系 · 密码**：✅ `password.ts`(Node 内置 scrypt 哈希 `scrypt$salt$hash` + timingSafeEqual + isValidPassword 8–128 位，无原生依赖)+4测。schema `User.password String?`(与 OTP 并存)。NextAuth 加第二个 Credentials provider `id:"password"`(邮箱+密码，verifyPassword)。`account` router(hasPassword / setPassword：已有密码须校验当前、OTP 用户凭登录态直接设)。登录页加 **验证码/密码** 分段切换 tab；profile 加「账号安全」`PasswordCard`(设置/修改密码，两次确认)。build 过、289 测过、部署 200。**e2e 全通**(CDP)：authed 调 account.setPassword→`{ok:true}`、DB password 落库、全新会话走密码登录表单→`finalPath:/onboarding、pwLoginLeft:true`。登录 tab + profile 卡截图确认。
- [x] **U-4 账号设置页 `/settings`**：✅ 新建 auth-gated `/settings`（未登录 redirect `/login?returnTo=/settings`，与 onboarding 同模式、不泄露账号内容）：**账号**(邮箱卡 + PasswordCard) / **偏好**(深色浅色 ThemeToggle + 色盲 ColorblindToggle，一卡分隔) / **退出登录**(LogoutButton)。把散落设置收拢一处。profile 去掉「账号安全」PasswordCard 与底部登出，改为「账号设置 →」链接到 /settings（profile 更聚焦投资内容）；sidebar 账号下拉加「设置」入口。build 过、部署 200、/settings PC+移动截图确认成熟居中、登出/主题/色盲/密码齐备。（删除账号高破坏，本轮不做。）
- [x] **U-5 移动端导航 & 信息层级**：✅ 安全区落地——layout `viewport-fit:cover` + TabBar `pb-[env(safe-area-inset-bottom)]` + 移动 header `min-h-14 pt-[env(safe-area-inset-top)]` + 内容 `pb-[calc(4rem+env(safe-area-inset-bottom))]`，真机刘海/底部指示条不再遮挡。TabBar 加**激活态顶部 amber 竖条**(超越纯色)+`aria-current`；可点区域保持 ≥44px。build 过、部署 200、移动首页截图确认激活条清晰、发现/通知等页信息层级 OK。（卡片圆角/内距/分隔的全站一致性 sweep 归到 U-7 组件级打磨一起做。）
- [x] **U-6 PC 端信息密度 & 宽度**：✅ 根因=各页内容宽度参差(home `max-w-[1500px]`、entity `max-w-[1360px]`、discover 5xl、feed/notif 4xl、profile/settings 3xl)——尤其 home 在 1920 宽屏上单列 hero(组合/自选股/早报)摊到 1500 太空旷、右半留白。修：把「宽栏 feed+rail 层」统一到**唯一 canonical 宽度 `max-w-7xl`(1280)**——home 1500→7xl、entity 1360→7xl（两页从此一致）；阅读层(feed/notif=4xl)与内容/表单层(profile/settings=3xl、onboarding=2xl)本已合理分级，保留。验收双端截图：**1920** home 内容被收敛到 1280 且**居中**、左右 ~190px 均衡 gutter(不再左贴边摊到 1500)；**1440** 主区 1184<1280 上限故内容照常填满、无回归。个股页两栏(thesis+aside)在 1280 下 feed≈928/aside 320 仍宽裕。build 过、部署 200。
- [x] **U-7 组件级打磨**：✅ 核心「有焦点态 + 控件一致」落地。①**全局键盘焦点环**（此前全站仅 4 处 focus-visible）：globals `@layer base` 给 `a/button/[role=button]/[tabindex]:focus-visible` 统一 amber `outline 2px + offset`（仅键盘触发、鼠标点击不扰）；放 base 层故带自定义 focus 的控件（如 sidebar 搜索 `focus-visible:ring`）仍能覆盖不双环。**CDP 实证**：Tab 到 发送验证码 btn / 返回首页·解牛·首页 link 均得 `2px solid rgb(245,166,35)`(brand)，sidebar 搜索得 `outline:none`+自身 ring——分层完全符合预期。②**输入框单一来源**：此前 4 处本地 const 3 种样式漂移(login/password `inputCls` rounded-xl+ring、editors `field` rounded-lg 无 ring、entity-search 内联)——统一抽到 section-head 的 `fieldCls`/`fieldClsSm`(含 placeholder 色/transition/focus ring/disabled 态)，login/password/decision/holding/entity-search 全部改引用。③抽 `brandBtn`(实心 amber + disabled)统一登录提交等。④**prefers-reduced-motion** 关过渡/动画(a11y)。build 过、部署 200、discover 搜索框截图确认渲染一致。（卡片半径 xl 为主、lg=小控件、2xl=hero/登录卡，判为合理分级、不做一刀切；loading 骨架非本轮。）
- [x] **U-8 深色模式核对**：✅ 逐页 `--dark` 截图（home/entity/login/settings，PC+移动）核对：语义色正确（上证 -0.06% 绿 / 科创50 +1.04% 红 = A 股红涨绿跌；个股 143.99 +2.62% 红=涨）、amber 强调一致、surface(#131c2e)/canvas(#0b1220) 靠 border-line 分层清晰、正文/muted 文本可读、登录 email 输入 amber 焦点环在深色下也清楚——**深色模式本就靠语义 token 架构自动适配、整体已成熟**。系统 grep 未发现真正「不适配」的硬编码色（主按钮/实体徽章/错误条均已带 `dark:` 变体，弹窗遮罩 bg-black/40、红色未读角标属非价格 UI 合规）。收尾清理：删除死代码 `post.tsx`（唯一未适配深色的 T3 样板、全项目无引用）；3 个图标开关 `text-gray-500 dark:text-gray-400`→token `text-muted`（视觉等价、更一致）；错误条 `text-red-600`+`dark:text-red-400`、密码成功条 `+dark:text-brand`（深色下更亮更可读）。build 过、部署 200。
- [x] **U-9 一致性 & 无障碍收尾**：✅ a11y sweep。审计发现基线本就强（`<html lang="zh-CN">`、图标按钮均有 aria-label、开关有 aria-pressed、icons.tsx 统一 aria-hidden、muted 文本对比过 AA、焦点环+reduced-motion 已在 U-7）。本轮补：①**跳到主内容 skip-link**（`sr-only`→`focus:not-sr-only`，指向内容 wrapper `#main-content` tabIndex=-1）——**CDP 实证**首个 Tab 即聚焦「跳到主内容」`href=#main-content` 带 amber outline，焦点顺序正确、可跳过导航；②sidebar 导航激活链接加 `aria-current="page"`（与 TabBar 一致）；③sidebar 账号下拉按钮加 `aria-expanded/aria-haspopup/aria-label`；④移动 header 三个图标按钮 tap 区域 ~20px→`p-2` 36px（过 WCAG 2.2 目标尺寸）。build 过、部署 200、移动 header 截图确认间距不挤、skip-link CDP 验证通过。

## 诚实约束
- 数值级行情（K 线/资金流）本就是后续基建（P4-10），本轮只做壳与信息呈现，不假装有数据。
- 账号体系以「够成熟、非破坏」为度，不引入复杂 RBAC/多因子（除非另议）。
