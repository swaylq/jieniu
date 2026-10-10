#!/usr/bin/env bash
#
# 服务内调度器的唯一启动入口。
#
# 为什么必须走这个脚本：OPENROUTER_API_KEY / ALI_KEY / ALI_SECRET 只在 secret store，
# 不在 .env。裸起 worker 能起来、日志也不报错，但所有 AI 任务会被标 skipped、
# 告警信发不出去。把 secret exec 写进命令结构里，比写进文档里可靠。
#
# 为什么每次都 delete 再 start：pm2 只在 `start` 时从客户端捕获环境变量，
# `pm2 restart` **不会**重新读 env（除非 --update-env，而那时也要在 secret exec 下跑）。
# 直接 delete + start 是唯一不会悄悄丢密钥的做法。
#
# 用法：
#   scripts/start-scheduler.sh
#   scripts/start-scheduler.sh --check-env   # 只核验配置，不启动或停止进程
#   scripts/start-scheduler.sh   # 收件人取自本项目 .env 的 OPS_ALERT_EMAIL

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NAME="${NAME:-jieniu-scheduler}"
LOG="${LOG:-/Users/mac/jieniu-scheduler.log}"
DB="${DATABASE_URL:-postgresql://mac@localhost:5432/jieniu}"

command -v secret >/dev/null 2>&1 || {
  echo "✗ 找不到 secret CLI —— 没它就注入不了密钥，拒绝启动"
  exit 1
}
command -v pm2 >/dev/null 2>&1 || {
  echo "✗ 找不到 pm2 —— 拒绝启动"
  exit 1
}

# OPS_ALERT_EMAIL 是普通运行配置，保存在本项目 `.env`（不提交）。
# 修改收件人后重新运行本脚本；Node 将 .env 传入 worker 环境。

# Node 20.6+；只检查变量名，不输出值；在停止任何进程前确认配置可读。
secret exec ALI_KEY ALI_SECRET OPENROUTER_API_KEY -- \
  node --env-file="$ROOT/.env" -e '
    const required = ["ALI_KEY", "ALI_SECRET", "OPENROUTER_API_KEY", "OPS_ALERT_EMAIL"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
      console.error("✗ 缺少启动配置：" + missing.join(" / "));
      process.exit(1);
    }
    console.log("✓ 启动配置齐全：" + required.join(" / "));
  '
if [ "${1:-}" = "--check-env" ]; then
  exit 0
fi

echo "→ 移除旧进程（保证密钥重新注入）"
pm2 delete "$NAME" >/dev/null 2>&1 || true

# pm2 启的是 node_modules/.bin/tsx 这个**启动壳**，真正跑 main.ts 的是它的子进程。
# `pm2 delete` 只杀壳，孙进程会被 reparent 成孤儿继续跑 —— 于是新旧两个 worker
# 同时抢任务（实测撞到过，一个跑旧代码一个跑新代码）。这里补一刀，按命令行精确匹配。
# main.ts 里还有一把 Postgres advisory lock 兜底，两层都要。
for _ in 1 2 3; do
  pgrep -f "src/scheduler/main.ts" >/dev/null 2>&1 || break
  pkill -f "src/scheduler/main.ts" || true
  sleep 1
done
if pgrep -f "src/scheduler/main.ts" >/dev/null 2>&1; then
  echo "✗ 还有 worker 进程杀不掉，拒绝启动（避免两个 worker 抢任务）："
  pgrep -fl "src/scheduler/main.ts"
  exit 1
fi

# 旧日志留着会让下面的 grep 读到上一轮的自检行，看不出本轮到底起没起来。
: >"$LOG"

echo "→ 启动（共用密钥来自 secret，OPS_ALERT_EMAIL 来自项目 .env）"
# 项目配置由 Node 的 --env-file 加载；不要用空的 env 参数覆盖收件人。
secret exec OPENROUTER_API_KEY ALI_KEY ALI_SECRET -- \
  env DATABASE_URL="$DB" \
      MAIL_FROM="解牛 <noreply@mail.auramate.net>" \
      ALI_REGION=cn-hangzhou \
  pm2 start node_modules/.bin/tsx \
      --name "$NAME" \
      --cwd "$ROOT" \
      --node-args="--env-file=$ROOT/.env" \
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
# 变量后面紧跟中文标点必须加花括号：bash 会把「，」的 UTF-8 字节当成变量名的一部分，
# 配上 set -u 就是 "NAME，: unbound variable"（本脚本第一次跑就撞了）。
echo "✓ 已启动 ${NAME}，日志 ${LOG}"
