# 问解牛 → 持续对话 + 流式（2026-07-29）

sway 三条诉求：**入口太边缘**、**应该是持续性的对话**、**需要 SSE + 打字机**。
三个选择均由 sway 拍板：入口取 **D（保留悬浮钮，做大做醒目）**、持久化取 **B（存库、一条连续线、跨设备）**、
流式取 **B（真流式 + 逐段合规护栏）**。

## 现状

- `layout.tsx` 挂 `<AskJieniu />`：右下角小圆钮 → 展开面板。
- `ask.answer` 是**单轮 tRPC mutation**：一问一答，答完即弃，无历史。
- `answerUserQuestion` → `chat(ASK_SYSTEM, prompt, 850)`，**一次性拿完整字符串**，无流式。
- 合规是**事后整段校验**：`isCompliant(全文)` 判废 + `withDisclaimer` 附免责。
- 库里没有任何对话表；`src/app/api` 下只有 auth 与 trpc 两个 route handler。

## 目标

1. 入口一眼能看见，不必去右下角找。
2. 回来还能接着聊，换台设备也在。
3. 边生成边显示，且**不牺牲合规**。

## 设计

### 数据模型

一条连续线，不做多会话（悬浮面板里塞会话列表是负担，YAGNI）。因此不需要 `Conversation` 表：

```prisma
model AskMessage {
  id        String   @id @default(cuid())
  userId    String
  role      String   // "user" | "assistant"
  content   String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
}
```

纯新增表，用 `prisma db push`（与仓库现行做法一致；迁移历史本就已漂移，见 lessons）。

### 上下文预算

每轮都要喂四层记忆（持仓/thesis/信号/决策），再叠历史，token 会滚雪球。
**只带最近 6 条消息**（约 3 问 3 答）进提示词，更早的存库但不进上下文。
常量 `ASK_HISTORY_TURNS = 6` 放 `src/lib/ask-history.ts`，纯函数 `recentTurns()` 负责截断，单测覆盖。

### 流式传输

新增 route handler `src/app/api/ask/stream/route.ts`（POST，`auth()` 保护）：

1. 取用户记忆 → `buildAskContext`（复用 `ask.answer` 那套查询）
2. 取最近 6 条历史 → `recentTurns`
3. 调 OpenRouter `stream: true`（新文件 `src/server/llm-stream.ts`，不动现有 `llm.ts` / `ai.ts` 的调用方）
4. 以 `text/event-stream` 往下吐 `delta` 事件
5. **逐段护栏**：每收到一块就把**已生成的前缀**跑一次 `isCompliant`。
   `isCompliant` 是纯正则扫描、不依赖全文完整性，所以对前缀成立。命中 → 吐 `blocked` 事件并**立刻中止**上游流。
6. 收尾：整段再跑一次 `isCompliant` 兜底 → `withDisclaimer` → 落库（user 与 assistant 两条）。
   判废则不落 assistant 那条（同「判废不入库」的既有惯例）。

客户端用 `fetch` + `ReadableStream` 读（`EventSource` 不能 POST），拿到的增量直接渲染——
**打字机效果就是流本身**，不额外做逐字动画。

### 客户端

`ask-jieniu.tsx` 重做成对话：消息列表（user 右 / assistant 左）+ 底部输入框 + 流式追加。
打开时用新的 `ask.history` query 拉历史。`记为投资笔记` 保留，挂在每条 assistant 消息上。

### 入口（D）

悬浮钮从小圆钮换成**带文字的胶囊**（图标 + 「问解牛」），尺寸与对比度都提上去，
位置仍在右下但明显更抢眼。不加装饰性 emoji、不加营销文案（维度 i 的既有约束）。

## 不做

- 多会话 / 会话列表 / 重命名删除（C 档，YAGNI）
- 「重新生成」「编辑重发」
- 移动端的独立对话页

## 验收

- 单测：`recentTurns` 截断、前缀护栏判定。
- 真实登录后端到端：发一条消息 → 看到**增量到达**（不是一次性整段）→ 刷新页面历史还在。
- 合规：构造一条会触发红线的提问，确认流被掐断且库里没有落下 assistant 消息。
- 三件套 + build + `start-prod.sh` + 公网 CSS 哈希 + AI 往返。
