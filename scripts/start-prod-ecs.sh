#!/usr/bin/env bash
#
# 国内 ECS（aliyun-main）生产启动入口 —— PM2 托管 web 进程。
# run-prod-ecs.sh 每次拉起读取 /etc/jieniu/env（600，root 写、ubuntu 读）。
# 构建仍单独跑（NODE_ENV=production npm run build，exit 0 才继续）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3838}"
LOG="${LOG:-/home/ubuntu/jieniu-prod.log}"
NAME="${NAME:-jieniu-web}"
export PORT LOG NAME

command -v pm2 >/dev/null 2>&1 || { echo "✗ 找不到 pm2" >&2; exit 1; }
bash scripts/run-prod-ecs.sh --check-env
[ "${1:-}" != "--check-env" ] || exit 0

# 仅首次迁移旧 nohup 进程；拒绝停止其他项目占用的端口。
if ! pm2 describe "$NAME" >/dev/null 2>&1; then
  old_pids=$(fuser "${PORT}/tcp" 2>/dev/null || true)
  for pid in $old_pids; do
    owner_root=$(readlink "/proc/$pid/cwd")
    owner_command=$(ps -p "$pid" -o comm=)
    if [ "$owner_root" != "$ROOT" ] || [[ "$owner_command" != next-server* ]]; then
      echo "✗ :$PORT 由其他进程占用（pid=$pid），拒绝停止" >&2
      exit 1
    fi
  done
  for pid in $old_pids; do kill -TERM "$pid"; done
  for _ in $(seq 1 20); do
    fuser "${PORT}/tcp" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if fuser "${PORT}/tcp" >/dev/null 2>&1; then
    echo "✗ :$PORT 未释放，拒绝启动" >&2
    exit 1
  fi
fi

log_offset=0
[ ! -f "$LOG" ] || log_offset=$(wc -c < "$LOG")
echo "→ PM2 启动 $NAME（异常退出或内存超限后自动重启）"
pm2 startOrRestart scripts/ecosystem-prod-ecs.config.cjs --only "$NAME" --update-env

echo "→ 等待就绪"
code=000
for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "  首页 HTTP=$code"
[ "$code" = "200" ] || { echo "✗ 起不来，见 $LOG"; tail -20 "$LOG"; exit 1; }

html=$(curl --fail --silent --show-error -m 10 "http://127.0.0.1:$PORT/")
css=$(printf '%s' "$html" | grep -oE '/_next/static/css/[^"]+\.css' | sed -n '1p' || true)
if [ -n "$css" ]; then
  ccode=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:$PORT$css" || true)
  echo "  CSS $css HTTP=$ccode"
  [ "$ccode" = "200" ] || { echo "✗ 资产哈希对不上，需重新 build + 重启"; exit 1; }
else
  echo "✗ 首页里没找到 CSS 链接，拒绝通过资产校验" >&2
  exit 1
fi

boot=$(tail -c "+$((log_offset + 1))" "$LOG" | grep -m1 '^\[boot\]' || true)
if [ -z "$boot" ]; then
  echo "✗ 本次启动缺 [boot] 自检行，见 $LOG" >&2
  exit 1
elif printf '%s' "$boot" | grep -q '✗'; then
  echo "✗ $boot"
  exit 1
else
  echo "  $boot"
fi

# 临时端口验收不能写入开机恢复清单。
if [ "${PM2_SAVE:-1}" = "1" ]; then pm2 save >/dev/null; fi
echo "✓ $NAME 已启动 pid=$(fuser "${PORT}/tcp" 2>/dev/null)，日志 $LOG"
