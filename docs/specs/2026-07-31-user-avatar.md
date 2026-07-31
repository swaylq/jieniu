# 用户可以设置头像

2026-07-31 · sway 直报「用户可以设置头像」

## 现状

`User.image` 这个字段从 T3 脚手架起就躺在 schema 里，**没有任何一行代码读它**。
头像目前完全是算出来的：`_components/user-avatar.tsx` 的 `UserAvatar` 按邮箱稳定散列
从 `AVATAR_GRADIENTS` 六组深色渐变里挑一组，叠邮箱首字母。三处调用：

- `_components/sidebar.tsx:266` —— 桌面侧栏底部账号块（`email` 由 layout 以 prop 传入）
- `app/profile/page.tsx:53` —— 我的组合页头
- `app/settings/page.tsx:34` —— 设置页账号卡

散列头像本身不难看，问题是它**不可改**，且首字母对中文用户基本是个随机大写字母
（邮箱 `mykh…@…` → `M`）。

## 要做什么

在散列头像之上叠两条可选路径，默认不变（没设置过的用户一切照旧）：

1. **上传照片** —— 选图 → 圆形取景裁剪 → 256×256 WebP 存本机 → 全站显示
2. **文字头像** —— 六组现成渐变里点选 + 自定义 1–2 个显示字符（如「张」）

优先级：有照片 → 照片；否则 → 文字头像（色/字各自缺省时回退散列/首字母）。

**不做**（YAGNI）：多头像历史、Gravatar、第三方登录头像同步、审核流程
（解牛没有社交流，头像只有用户自己看得见）、动图。

## 数据模型

`User` 加两列，都可空：

```prisma
avatarColor Int?     // AVATAR_GRADIENTS 下标 0–5；null = 按 seed 散列
avatarChar  String?  // 1–2 个显示字符；null = 邮箱首字母
```

上传的照片沿用既有的 `image String?`，存**相对 URL**：`/api/avatar/<userId>?v=<8位内容哈希>`。
不存 base64（每次 SSR 背几十 KB 太贵），不存绝对 URL（换域名就全废）。

迁移：`prisma/migrations/<ts>_user_avatar_prefs/migration.sql`，两条 `ADD COLUMN`，
可空无默认值 → 对存量行零影响。本项目 dev 与 prod 是同一个库
（`postgresql://mac@localhost:5432/jieniu`），迁移即上线，必须一次写对。

## 文件存储

- 目录 `var/avatars/<userId>.webp`（`process.cwd()` 下，加进 `.gitignore`）。
  不放 `public/` —— 那是仓库内容，写进去会污染工作树。
- 写入走 **临时文件 + `rename`**：`rename` 在同一文件系统上是原子的，
  避免读到写了一半的文件。
- `sharp`（node_modules 已有 0.34.5，但要**显式写进 `package.json` dependencies**——
  现在它只是 Next 的可选依赖，哪天 Next 不带了就静默炸）：
  `.rotate()`（吃掉 EXIF 方向，否则手机竖拍照片会躺倒）
  `.resize(256, 256, { fit: "cover" })`
  `.webp({ quality: 82 })` → 稳定落在 10–25 KB。

## 分层

### `src/lib/avatar.ts`（纯函数，单测覆盖）

| 导出 | 职责 |
|---|---|
| `resolveAvatar(prefs, seed)` | 优先级判定 → `{kind:"image",src}` \| `{kind:"glyph",from,to,text}` |
| `normalizeAvatarChar(raw)` | 去空白、按**字素**取前 2 个（emoji / 代理对不能按 `.slice(0,2)` 切）；空 → null |
| `clampColorIndex(n)` | 越界/非整数 → null |
| `cropSourceRect(...)` | 裁剪几何：自然尺寸 + 缩放 + 平移 → 源图矩形（见下） |

裁剪几何模型（客户端预览与最终出图共用同一套数）：

- 取景框是边长 `V` 的正方形；`baseScale = V / min(naturalW, naturalH)`（zoom=1 即 cover）
- 实际缩放 `k = baseScale * zoom`；平移 `(tx, ty)` 是图心相对框心的 CSS 像素偏移
- 源矩形边长 `s = V / k`；`sx = (naturalW - s)/2 - tx/k`，`sy` 同理
- `sx` 夹在 `[0, naturalW - s]`，`sy` 夹在 `[0, naturalH - s]` —— 保证取景框永远被图填满

### `src/server/avatar-store.ts`（文件 IO + sharp）

`saveAvatarImage(userId, buf)` → `{ version }`；`readAvatarImage(userId)`；`deleteAvatarImage(userId)`。
`userId` 一律先过 `/^[a-z0-9]{20,32}$/i` 校验再拼路径——**防目录穿越**。

### tRPC `account.ts`

单个 `setAvatar` mutation，输入是判别联合，让「三种状态互斥」写进类型而不是散文：

```ts
| { kind: "image"; dataUrl: string }        // 客户端裁好的 512×512 WebP，≤1.5 MB
| { kind: "preset"; color: number | null; char: string | null }  // 同时清掉照片
| { kind: "reset" }                          // 回到散列默认
```

`kind:"image"` 服务端二次把关：解码 dataURL → **查魔数**（不信 MIME 声明）只放行
png/jpeg/webp → sharp 转码。转码本身就是一道消毒（畸形文件在这里抛，不会落盘）。

另加 `getAvatar` query 供编辑器读当前值。

### `src/app/api/avatar/[id]/route.ts`

`GET` → 读文件 → `image/webp` + `Cache-Control: public, max-age=31536000, immutable`
（URL 带 `?v=<hash>`，改了头像 URL 就变，缓存永不失效也不会脏）。文件不存在 → 404。
**不加鉴权**：头像不敏感，加了就没法走 CDN/浏览器缓存；`id` 走上面那条正则白名单。

### 头像怎么到达三处 UI

session 是 **JWT 策略**且回调里只带 `id`，客户端没有 `SessionProvider`（`useSession().update()`
用不了）。所以不走 token，走一个 React `cache()` 包住的服务端读取：

```ts
// src/server/viewer-avatar.ts
export const getViewerAvatar = cache(async () => { … })  // 按 PK 取三列
```

`cache()` 让 layout 与页面在同一次渲染里只查一次。写操作后 `router.refresh()` 即全站更新
（项目既有写路径都是这个模式）。

`UserAvatar` 加一个可选 `avatar` prop：有图渲染 `<img>`，否则维持现在的渐变 span。
形状（`rounded-full` + 发丝环 + 轻投影）仍由组件锁定，调用方改不了 —— DESIGN.md 的头像铁律不变。

### 编辑器 UI：`/settings/avatar`

独立路由而不是弹层：裁剪交互体积不小，独立页省掉焦点陷阱 / 滚动锁 / 返回键那一堆
无障碍活儿，移动端也更好用。设置页账号卡加一个「更换头像」按钮指过去。

页面结构：当前头像大预览 → 「上传照片」区（选图后就地出圆形取景框 + 缩放滑块）→
「文字头像」区（六个色卡 + 字符输入框，实时预览）→ 「恢复默认」（仅在已自定义时出现）。

缩放用**滑块**不用双指捏合：桌面移动同一套代码，绕开触屏手势那一堆边界情况。
拖动定位用 pointer events（`setPointerCapture`），鼠标触屏通吃。

## 错误处理

| 情况 | 处理 |
|---|---|
| 选了 HEIC（iPhone 原图） | 浏览器 `<img>` 解不了 → 明确提示「换 JPG/PNG，或在相册里先导出」 |
| 文件过大 / 非图片 | 客户端先拦（`accept` + 20 MB 上限 + 解码失败提示），服务端魔数再拦一次 |
| sharp 转码抛错 | mutation 返回 `BAD_REQUEST`「这张图读不出来」，**不落盘、不改库** |
| 落盘成功但 DB 更新失败 | 先写文件再更新 DB；DB 失败则删掉刚写的文件（补偿），避免孤儿文件 |
| 读取时文件丢失（手工删过） | route 返回 404，`<img>` 的 `onError` 回退到渐变头像，不出破图 |

## 验证

- 单测：`avatar.test.ts`（优先级 / 字素截断 / 越界色号 / 裁剪几何含夹紧边界）、
  `avatar-store.test.ts`（真实 sharp 跑一遍：进任意尺寸出 256×256 WebP；目录穿越被拒）
- 真实链路：起隔离 dev（`NEXT_DIST_DIR=.next-dev`），用项目自带的真实登录流程拿 cookie
  （播种 OTP → POST credentials，**别手工铸 session cookie**，那条路踩过），
  真浏览器上传一张图 → 看三处 UI 是否都换了 → 跨断点截图（移动端那张不是可选项）
- 部署前置三件套：`vitest run` + `tsc --noEmit` + `next lint`，都在 `build` **之前**跑；
  `build` 完**必重启**（走 `scripts/start-prod.sh`，绝不裸起）
