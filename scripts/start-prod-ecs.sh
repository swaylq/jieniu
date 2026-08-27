#!/usr/bin/env bash
#
# 国内 ECS（aliyun-main）生产启动入口 —— web 进程。
# 与 start-prod.sh 的唯一差别：密钥不来自 secret CLI，而是读 /etc/jieniu/env（600，root 写、ubuntu 读）。
# 构建仍单独跑（NODE_ENV=production npm run build，exit 0 才继续）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3838}"
LOG="${LOG:-/home/ubuntu/jieniu-prod.log}"

set -a; . /etc/jieniu/env; set +a

echo "→ 停掉 :$PORT 上的旧进程"
fuser -k "${PORT}/tcp" 2>/dev/null || true
sleep 1

echo "→ 启动（密钥来自 /etc/jieniu/env）"
env NODE_ENV=production PORT="$PORT" \
  OPENROUTER_ASK_MODEL="${OPENROUTER_ASK_MODEL:-openai/gpt-5.6-terra}" \
  AUTH_URL="${AUTH_URL:-https://jieniu.club}" \
  MAIL_FROM="解牛 <noreply@mail.auramate.net>" \
  ALI_REGION=cn-hangzhou \
  ALI_SMS_SIGN_NAME="${ALI_SMS_SIGN_NAME:-执楠科技}" \
  ALI_SMS_TEMPLATE_CODE="${ALI_SMS_TEMPLATE_CODE:-SMS_501775398}" \
  nohup npm run start >"$LOG" 2>&1 & disown

echo "→ 等待就绪"
code=000
for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "  首页 HTTP=$code"
[ "$code" = "200" ] || { echo "✗ 起不来，见 $LOG"; tail -20 "$LOG"; exit 1; }

css=$(curl -s -m 10 "http://127.0.0.1:$PORT/" | grep -oE '/_next/static/css/[^"]+\.css' | head -1)
if [ -n "$css" ]; then
  ccode=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:$PORT$css" || true)
  echo "  CSS $css HTTP=$ccode"
  [ "$ccode" = "200" ] || { echo "✗ 资产哈希对不上，需重新 build + 重启"; exit 1; }
else
  echo "  ⚠ 首页里没找到 CSS 链接，跳过资产校验"
fi

boot=$(grep -m1 '^\[boot\]' "$LOG" || true)
if [ -z "$boot" ]; then
  echo "  ⚠ 日志里没有 [boot] 自检行"
elif printf '%s' "$boot" | grep -q '✗'; then
  echo "✗ $boot"
  exit 1
else
  echo "  $boot"
fi

echo "✓ 已启动 pid=$(fuser "${PORT}/tcp" 2>/dev/null)，日志 $LOG"
