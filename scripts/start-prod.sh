#!/usr/bin/env bash
#
# 生产启动的唯一入口。
#
# 为什么必须走这个脚本：ALI_KEY / ALI_SECRET / OPENROUTER_API_KEY / AUTH_SECRET 不都在 `.env` 里，
# 只在 `secret` store 里。直接 `NODE_ENV=production PORT=3838 npm run start` 能起来、
# 首页也 200，但这三个 key **静默**缺失 —— AI 全线（问解牛 / 解读 / thesis / drift /
# 画像 / 事件摘要）每次调用秒失败，登录验证码也发不出去。2026-07-25 就是这么坏的。
# 把 `secret exec` 写进命令结构里，比写进文档里可靠。
#
# 用法：
#   scripts/start-prod.sh            # 停旧进程 → 起新进程 → 自检
#   PORT=3939 scripts/start-prod.sh  # 换端口
#
# 本脚本**不做 build**。改了代码要先单独跑 `NODE_ENV=production npm run build`
# 并确认 exit 0，再跑本脚本（构建失败还照样杀线上，是踩过的坑）。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3838}"
LOG="${LOG:-/Users/mac/jieniu-prod.log}"

command -v secret >/dev/null 2>&1 || {
  echo "✗ 找不到 secret CLI —— 没它就注入不了密钥，拒绝启动"
  exit 1
}

echo "→ 停掉 :$PORT 上的旧进程"
lsof -ti:"$PORT" | xargs kill 2>/dev/null || true
sleep 1

# AUTH_SECRET 也走 secret store：`.env` 里那份是一句自然语言（含空格、非 base64），
# 熵太低不该拿来签会话；store 里是标准的 `openssl rand -base64 32`。进程 env 优先级高于
# `.env`，注入即生效。`.env` 的弱值保留只为让 `next build` / 本地 dev 的 env 校验能过——
# 真要绕过本脚本裸起，下面的 [boot] 自检会把「用的是弱密钥」喊出来。
echo "→ 启动（secret exec 注入 ALI_KEY / ALI_SECRET / OPENROUTER_API_KEY / AUTH_SECRET）"
secret exec ALI_KEY ALI_SECRET OPENROUTER_API_KEY AUTH_SECRET -- \
  env NODE_ENV=production PORT="$PORT" \
  MAIL_FROM="解牛 <noreply@mail.auramate.net>" \
  ALI_REGION=cn-hangzhou \
  nohup npm run start >"$LOG" 2>&1 &
disown

echo "→ 等待就绪"
code=000
for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "  首页 HTTP=$code"
[ "$code" = "200" ] || { echo "✗ 起不来，见 $LOG"; tail -20 "$LOG"; exit 1; }

# 只看首页 200 会骗人：`next start` 底下重建 .next 时，变更过的静态资产会 400
# 而 SSR 的 HTML 仍 200。所以校验当前 HTML 真正引用的那个 CSS 哈希。
css=$(curl -s -m 10 "http://127.0.0.1:$PORT/" | grep -oE '/_next/static/css/[^"]+\.css' | head -1)
if [ -n "$css" ]; then
  ccode=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:$PORT$css" || true)
  echo "  CSS $css HTTP=$ccode"
  [ "$ccode" = "200" ] || { echo "✗ 资产哈希对不上（.next 与进程分叉），需重新 build + 重启"; exit 1; }
else
  echo "  ⚠ 首页里没找到 CSS 链接，跳过资产校验"
fi

# 密钥自检：src/instrumentation.ts 在启动时打 [boot] 行。
boot=$(grep -m1 '^\[boot\]' "$LOG" || true)
if [ -z "$boot" ]; then
  echo "  ⚠ 日志里没有 [boot] 自检行（instrumentation 未生效？）"
elif printf '%s' "$boot" | grep -q '✗'; then
  echo "✗ $boot"
  exit 1
else
  echo "  $boot"
fi

echo "✓ 已启动 pid=$(lsof -ti:"$PORT" | head -1)，日志 $LOG"
