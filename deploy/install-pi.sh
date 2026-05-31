#!/usr/bin/env bash
# HOTOVO — first-time install on a server / Raspberry Pi 4.
# Run on the Pi as a user with sudo. Idempotent-ish; safe to re-run.
#
#   curl -fsSL .../install-pi.sh | bash      # (or copy & run)
#   REPO=git@github.com:raven2cz/HOTOVO.git APP_DIR=/opt/hotovo ./install-pi.sh
set -euo pipefail

REPO="${REPO:-git@github.com:raven2cz/HOTOVO.git}"
APP_DIR="${APP_DIR:-/opt/hotovo}"
APP_USER="${APP_USER:-hotovo}"

say() { printf '\033[0;34m==>\033[0m %s\n' "$1"; }

# 1. Node.js 20+ check
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Node.js 20+ is required. Install it (e.g. nvm or distro package) and re-run." >&2
  exit 1
fi

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

# 4. Dependencies + frontend build (build at deploy time, not on service start)
say "Installing dependencies + building frontend"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm run install:all && npm run build:frontend"

# 5. Data dir + env file (with a generated encryption key)
sudo -u "$APP_USER" mkdir -p "$APP_DIR/data" "$APP_DIR/etc"
ENV_FILE="$APP_DIR/etc/hotovo.env"
if [ ! -f "$ENV_FILE" ]; then
  say "Creating $ENV_FILE"
  KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  sudo -u "$APP_USER" bash -lc "sed 's|^TODO_SECRET_KEY=.*|TODO_SECRET_KEY=$KEY|' '$APP_DIR/deploy/hotovo.env.example' > '$ENV_FILE'"
  sudo chmod 600 "$ENV_FILE"
fi

# 6. systemd unit
say "Installing systemd service"
sudo cp "$APP_DIR/deploy/systemd/hotovo.service" /etc/systemd/system/hotovo.service
sudo systemctl daemon-reload
sudo systemctl enable --now hotovo
sleep 3
sudo systemctl --no-pager --full status hotovo | head -8 || true

cat <<EOF

\033[0;32mHOTOVO is installed and running on 127.0.0.1:3000.\033[0m

Next steps (manual):
  1. nginx:   sudo cp $APP_DIR/deploy/nginx-hotovo.conf /etc/nginx/sites-available/hotovo
              sudo ln -sf /etc/nginx/sites-available/hotovo /etc/nginx/sites-enabled/hotovo
              sudo nginx -t && sudo systemctl reload nginx
  2. TLS:     ensure DNS hotovo.fishlive.org → this host; certs at /etc/letsencrypt/live/fishlive.org/
              (or run: sudo certbot --nginx -d hotovo.fishlive.org)
  3. Token:   the first-run AI agent token was written to $APP_DIR/data/INITIAL_TOKEN.txt
              (copy it, then delete the file). The web UI needs a token because
              LOCAL_UI_BYPASS=false behind the proxy — paste it in Nastavení.
  4. Update later:  ./scripts/deploy-pi.sh   (from the dev box)
EOF
