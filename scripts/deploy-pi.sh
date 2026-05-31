#!/usr/bin/env bash
# HOTOVO — update an existing /opt/hotovo install on the Pi from this dev box.
# Pulls latest main on the Pi, reinstalls deps, rebuilds the frontend, restarts.
#
#   PI=pi@fishlive.org ./scripts/deploy-pi.sh
set -euo pipefail

PI="${PI:-pi@fishlive.org}"
APP_DIR="${APP_DIR:-/opt/hotovo}"
APP_USER="${APP_USER:-hotovo}"
SSH="ssh -o ConnectTimeout=15"

echo "=== 1/4 Pull latest on Pi ==="
$SSH "$PI" "sudo -u $APP_USER git -C $APP_DIR pull --ff-only origin main"

echo "=== 2/4 Install deps + build frontend ==="
$SSH "$PI" "sudo -u $APP_USER bash -lc 'cd $APP_DIR && npm run install:all && npm run build:frontend'"

echo "=== 3/4 Restart service ==="
$SSH "$PI" "sudo systemctl restart hotovo"

echo "=== 4/4 Health check ==="
sleep 4
$SSH "$PI" "curl -sf http://127.0.0.1:3000/api/health" && echo

echo "Deploy complete."
