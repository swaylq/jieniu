#!/usr/bin/env bash
#
# 国内 ECS（aliyun-main）调度器启动入口 —— pm2 进程。
# 与 start-scheduler.sh 的差别：密钥读 /etc/jieniu/env；pm2 以 ubuntu 用户跑（pm2_home=/home/ubuntu/.pm2）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NAME="${NAME:-jieniu-scheduler}"
LOG="${LOG:-/home/ubuntu/jieniu-scheduler.log}"

set -a; . /etc/jieniu/env; set +a
[ -n "${DATABASE_URL:-}" ] || { echo "✗ 缺 DATABASE_URL（/etc/jieniu/env）"; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "✗ 找不到 pm2"; exit 1; }

echo "→ 移除旧进程（保证密钥重新加载）"
pm2 delete "$NAME" >/dev/null 2>&1 || true
for _ in 1 2 3; do
  pgrep -f "src/scheduler/main.ts" >/dev/null 2>&1 || break
  pkill -f "src/scheduler/main.ts" || true
  sleep 1
done
if pgrep -f "src/scheduler/main.ts" >/dev/null 2>&1; then
  echo "✗ 还有 worker 进程杀不掉，拒绝启动："
  pgrep -fl "src/scheduler/main.ts"
  exit 1
fi

: >"$LOG"

echo "→ 启动（密钥来自 /etc/jieniu/env）"
env DATABASE_URL="$DATABASE_URL" \
    MAIL_FROM="解牛 <noreply@mail.auramate.net>" \
    ALI_REGION=cn-hangzhou \
  pm2 start node_modules/.bin/tsx \
      --name "$NAME" \
      --cwd "$ROOT" \
      --output "$LOG" --error "$LOG" \
      --time \
      -- src/scheduler/main.ts

echo "→ 等待启动自检"
for _ in $(seq 1 20); do
  grep -q '\[scheduler\] 已加载' "$LOG" 2>/dev/null && break
  sleep 1
done

boot=$(grep -m1 '\[scheduler\] [✓✗] 密钥' "$LOG" || true)
if [ -z "$boot" ]; then
  echo "✗ 日志里没有 [scheduler] 密钥自检行，worker 可能没起来。见 $LOG"
  tail -30 "$LOG" || true
  exit 1
elif printf '%s' "$boot" | grep -q '✗'; then
  echo "✗ $boot"
  exit 1
else
  echo "  ${boot#*] }"
fi

loaded=$(grep -m1 '已加载 .* 条任务' "$LOG" || true)
if [ -z "$loaded" ]; then
  echo "✗ 没看到「已加载 N 条任务」，worker 没进主循环。见 $LOG"
  exit 1
fi
echo "  ${loaded#*] }"

pm2 save >/dev/null 2>&1 || true
echo "✓ 已启动 ${NAME}，日志 ${LOG}"
