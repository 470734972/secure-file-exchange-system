#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/secure-file-exchange}"
SERVICE="${SERVICE:-secure-file-exchange}"
BRANCH="${BRANCH:-codex/secure-file-exchange-system}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/secure-file-exchange}"
DATA_DIR="${DATA_DIR:-/var/lib/secure-file-exchange}"
CONFIG_FILE="${CONFIG_FILE:-/etc/secure-file-exchange/sfx.env}"

[[ $EUID -eq 0 ]] || { echo '请使用 root 或 sudo 执行。'; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { echo "未找到 Git 工作目录：$APP_DIR"; exit 1; }
command -v node >/dev/null || { echo '未找到 Node.js，请先安装 Node.js 20+。'; exit 1; }

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="$BACKUP_ROOT/$timestamp"
mkdir -p "$backup_dir"

echo '[1/5] 备份运行数据和配置...'
[[ -d "$DATA_DIR" ]] && tar -C "$(dirname "$DATA_DIR")" -czf "$backup_dir/data.tar.gz" "$(basename "$DATA_DIR")"
[[ -f "$CONFIG_FILE" ]] && install -m 0600 "$CONFIG_FILE" "$backup_dir/sfx.env"

echo '[2/5] 检查本地代码状态...'
cd "$APP_DIR"
git diff --quiet && git diff --cached --quiet || { echo '检测到本机未提交代码，升级已取消；请先提交或还原本地修改。'; exit 1; }

echo "[3/5] 拉取分支：$BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo '[4/5] 更新 Node.js 依赖...'
npm install --omit=dev
chown -R root:root "$APP_DIR"

echo '[5/5] 重启并检查服务...'
install -m 0644 deploy/secure-file-exchange.service "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 80 --no-pager; exit 1; }

echo "升级成功：$(git rev-parse --short HEAD)"
echo "备份位置：$backup_dir"
