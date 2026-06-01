#!/usr/bin/env bash
# HOTOVO - first-time install on a server / Raspberry Pi 4.
# Run on the Pi as a user with sudo. Idempotent-ish; safe to re-run.
#
#   REPO=git@github.com:raven2cz/HOTOVO.git ./deploy/install-pi.sh
set -euo pipefail

REPO="${REPO:-git@github.com:raven2cz/HOTOVO.git}"
APP_DIR="${APP_DIR:-/opt/hotovo}"
APP_USER="${APP_USER:-hotovo}"
PUBLIC_PORT="${PUBLIC_PORT:-17854}"   # nginx public SSL port (forward this in the router)

say() { printf '\033[0;34m==>\033[0m %s\n' "$1"; }

# 1. Node.js 20+ (resolve its real path - works with a fnm-managed Node too)
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Node.js 20+ is required and must be on PATH (e.g. via fnm: 'fnm use 20'). Re-run after." >&2
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"
say "Using Node $(node --version) from $NODE_DIR"

# 2. Dedicated system user
if ! id "$APP_USER" >/dev/null 2>&1; then
  say "Creating system user $APP_USER"
  sudo useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
fi

# 3. Source tree at $APP_DIR (clone or pull)
sudo mkdir -p "$APP_DIR"
sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  say "Updating existing checkout"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  say "Cloning $REPO"
  sudo -u "$APP_USER" git clone "$REPO" "$APP_DIR"
fi

# 4. Pin Node to a fixed path so the nologin systemd user can find it
say "Pinning Node for systemd at $APP_DIR/.node/node"
sudo -u "$APP_USER" mkdir -p "$APP_DIR/.node"
sudo -u "$APP_USER" ln -sf "$NODE_BIN" "$APP_DIR/.node/node"

# 5. Dependencies + frontend build (build at deploy time, not on service start)
say "Installing dependencies + building frontend"
sudo -u "$APP_USER" env "PATH=$NODE_DIR:$PATH" bash -c "cd '$APP_DIR' && npm run install:all && npm run build:frontend"

# 6. Data dir + env file (with a generated encryption key)
sudo -u "$APP_USER" mkdir -p "$APP_DIR/data" "$APP_DIR/etc"
ENV_FILE="$APP_DIR/etc/hotovo.env"
if [ ! -f "$ENV_FILE" ]; then
  say "Creating $ENV_FILE"
  KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  sudo -u "$APP_USER" bash -c "sed 's|^TODO_SECRET_KEY=.*|TODO_SECRET_KEY=$KEY|' '$APP_DIR/deploy/hotovo.env.example' > '$ENV_FILE'"
  sudo chmod 600 "$ENV_FILE"
fi

# 7. systemd unit
say "Installing systemd service"
sudo cp "$APP_DIR/deploy/systemd/hotovo.service" /etc/systemd/system/hotovo.service
sudo systemctl daemon-reload
sudo systemctl enable --now hotovo
sleep 3
sudo systemctl --no-pager --full status hotovo | head -8 || true

cat <<EOF

HOTOVO is installed and running on 127.0.0.1:3000.

Next steps (manual):
  1. nginx (public TLS on port $PUBLIC_PORT):
       sudo cp $APP_DIR/deploy/nginx-hotovo.conf /etc/nginx/sites-available/hotovo
       sudo ln -sf /etc/nginx/sites-available/hotovo /etc/nginx/sites-enabled/hotovo
       sudo nginx -t && sudo systemctl reload nginx
  2. Router: forward external TCP $PUBLIC_PORT -> this Pi:$PUBLIC_PORT.
     Public URL becomes:  https://fishlive.org:$PUBLIC_PORT
     (reuses the existing Let's Encrypt cert for fishlive.org)
  3. Google OAuth redirect URI (register in Google Cloud):
       https://fishlive.org:$PUBLIC_PORT/api/sync/callback
  4. Token: first-run AI agent token is in $APP_DIR/data/INITIAL_TOKEN.txt.
     Behind the proxy LOCAL_UI_BYPASS=false, so the web UI needs it - paste it
     once in Nastavení (it's stored in the browser). Then delete the file.
  5. Update later:  PI=pi@fishlive.org ./scripts/deploy-pi.sh   (from the dev box)
EOF
