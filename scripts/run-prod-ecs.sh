#!/usr/bin/env bash
# PM2 每次拉起都在子进程里读取配置，密钥不进入 ecosystem 文件。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ -r /etc/jieniu/env ] || { echo "✗ 无法读取 /etc/jieniu/env" >&2; exit 1; }
set -a
. /etc/jieniu/env
set +a

for key in DATABASE_URL AUTH_SECRET ALI_KEY ALI_SECRET OPENROUTER_API_KEY; do
  [ -n "${!key:-}" ] || { echo "✗ 缺 $key（/etc/jieniu/env）" >&2; exit 1; }
done
[ -s .next/BUILD_ID ] || { echo "✗ 缺生产构建 .next/BUILD_ID" >&2; exit 1; }
[ -r node_modules/next/dist/bin/next ] || { echo "✗ 缺 Next.js 运行依赖" >&2; exit 1; }
command -v node >/dev/null

if [ "${1:-}" = "--check-env" ]; then
  echo "✓ 运行配置、依赖和生产构建齐全"
  exit 0
fi

export NODE_ENV=production PORT="${PORT:-3838}"
export OPENROUTER_ASK_MODEL="${OPENROUTER_ASK_MODEL:-openai/gpt-5.6-terra}"
export AUTH_URL="${AUTH_URL:-https://jieniu.club}"
export MAIL_FROM="解牛 <noreply@mail.auramate.net>" ALI_REGION=cn-hangzhou
export ALI_SMS_SIGN_NAME="${ALI_SMS_SIGN_NAME:-执楠科技}"
export ALI_SMS_TEMPLATE_CODE="${ALI_SMS_TEMPLATE_CODE:-SMS_501775398}"

# exec 保持 PID 不变，PM2 监控实际 Next.js 进程的内存和退出状态。
exec node --max-old-space-size=2048 node_modules/next/dist/bin/next start -p "$PORT"
