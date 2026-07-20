#!/usr/bin/env bash
set -euo pipefail
APP=/opt/secure-file-exchange
DATA=/var/lib/secure-file-exchange
[[ $EUID -eq 0 ]] || { echo 'Run as root'; exit 1; }
command -v node >/dev/null || { echo 'Install Node.js 20+ first, then run npm ci in the application directory.'; exit 1; }
id sfx &>/dev/null || useradd --system --home-dir "$DATA" --shell /sbin/nologin sfx
install -d -m 0750 -o sfx -g sfx "$DATA"
cd "$APP"
npm install --omit=dev
chown -R root:root "$APP"
install -m 0644 deploy/secure-file-exchange.service /etc/systemd/system/secure-file-exchange.service
install -d -m 0750 -o root -g sfx /etc/secure-file-exchange
systemctl daemon-reload
echo 'Create /etc/secure-file-exchange/sfx.env from deploy/sfx.env.example, then start secure-file-exchange.'
echo 'Configure firewalld source CIDRs before exposing 8080/8081. Do not open both ports in public.'
