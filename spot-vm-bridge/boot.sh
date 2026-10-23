#!/usr/bin/env bash
# ==============================================================================
# /data/hermes/boot.sh — Automatic Spot VM Reallocation & Reboot Recovery
# Restores all Hermes Agent symlinks, configs, and systemd services from /data
# ==============================================================================
set -e

echo "[hermes-boot] Restoring Hermes Agent from persistent disk /data/hermes..."

mkdir -p /data/hermes/storage/sessions /data/hermes/.cache/ms-playwright /root/.local/bin /root/.config /root/.cache /usr/local/bin /data/bin
if [ ! -L /root/.cache/ms-playwright ]; then
  rm -rf /root/.cache/ms-playwright
  ln -sfn /data/hermes/.cache/ms-playwright /root/.cache/ms-playwright
fi

# 1. Restore directory symlinks
if [ ! -L /root/.hermes ]; then
  rm -rf /root/.hermes
  ln -s /data/hermes/.hermes /root/.hermes
fi
ln -sfn /data/hermes/.hermes /home/azureuser/.hermes 2>/dev/null || true

if [ ! -L /root/hermes-cloudflare-web ]; then
  rm -rf /root/hermes-cloudflare-web
  ln -s /data/hermes/hermes-cloudflare-web /root/hermes-cloudflare-web
fi

if [ ! -L /root/.wrangler ]; then
  rm -rf /root/.wrangler
  ln -s /data/hermes/.wrangler /root/.wrangler
fi
ln -sfn /data/hermes/.wrangler /root/.config/.wrangler

# 2. Restore CLI binary symlinks and workspace links
WS_DIR="/data/hermes/.hermes/installs/8a4017c4cabfe15f/environments/5b3526e22336490dac2bb79381a4c7af/workspace"
HA_DIR="/data/hermes/.hermes/hermes-agent"
ln -sfn /data/hermes/.hermes/installs/8a4017c4cabfe15f/environments/5b3526e22336490dac2bb79381a4c7af/venv "$HA_DIR/venv"
ln -sfn "$HA_DIR/hermes_cli/web_dist" "$WS_DIR/hermes_cli/web_dist"
for item in ui-tui node_modules web package.json package-lock.json .git; do
  [ -e "$HA_DIR/$item" ] && [ ! -e "$WS_DIR/$item" ] && ln -sfn "$HA_DIR/$item" "$WS_DIR/$item" || true
done
for env_ws in /data/hermes/.hermes/installs/*/environments/*/workspace; do
  if [ -d "$env_ws/agent" ] && [ -d "$HA_DIR/agent" ]; then
    cp -f "$HA_DIR/agent/retry_utils.py" "$env_ws/agent/retry_utils.py" 2>/dev/null || true
    cp -f "$HA_DIR/agent/turn_recovery_autorecover.py" "$env_ws/agent/turn_recovery_autorecover.py" 2>/dev/null || true
    cp -f "$HA_DIR/agent/turn_api_error.py" "$env_ws/agent/turn_api_error.py" 2>/dev/null || true
  fi
done
chmod +x /data/hermes/.hermes/hermes-agent/venv/bin/hermes /data/hermes/start-tunnel.sh /data/bin/cloudflared 2>/dev/null || true
mkdir -p "$WS_DIR/.hermes/bin" /data/hermes/.hermes/bin
cat << 'EOF' > "$WS_DIR/.hermes/bin/hermes"
#!/bin/sh
exec /data/hermes/.hermes/hermes-agent/venv/bin/hermes "$@"
EOF
chmod +x "$WS_DIR/.hermes/bin/hermes"
cp -f "$WS_DIR/.hermes/bin/hermes" /data/hermes/.hermes/bin/hermes
chmod +x /data/hermes/.hermes/bin/hermes
ln -sfn /data/bin/cloudflared /usr/local/bin/cloudflared 2>/dev/null || true
ln -sfn /data/hermes/.hermes/hermes-agent/venv/bin/hermes /data/bin/hermes
ln -sfn /data/hermes/.hermes/hermes-agent/venv/bin/hermes /usr/local/bin/hermes
ln -sfn /data/hermes/.hermes/hermes-agent/venv/bin/hermes /root/.local/bin/hermes

# 3. Install and start systemd services
cp -f /data/hermes/hermes-gateway.service /etc/systemd/system/hermes-gateway.service
cp -f /data/hermes/hermes-dashboard.service /etc/systemd/system/hermes-dashboard.service
cp -f /data/hermes/hermes-bridge.service /etc/systemd/system/hermes-bridge.service
systemctl stop hermes-sync.service 2>/dev/null || true
systemctl disable hermes-sync.service 2>/dev/null || true
systemctl daemon-reload
systemctl enable hermes-gateway.service hermes-dashboard.service hermes-bridge.service
systemctl restart hermes-gateway.service hermes-dashboard.service hermes-bridge.service

echo "[hermes-boot] Native Hermes Agent Web Dashboard active on 127.0.0.1:9119 and routed to hermes.rpcserve.website."
