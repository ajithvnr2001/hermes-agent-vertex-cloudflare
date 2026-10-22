#!/usr/bin/env bash
# ==============================================================================
# /data/hermes/boot.sh — Automatic Spot VM Reallocation & Reboot Recovery
# Restores all Hermes Agent symlinks, configs, and systemd services from /data
# ==============================================================================
set -e

echo "[hermes-boot] Restoring Hermes Agent from persistent disk /data/hermes..."

mkdir -p /data/hermes/storage/sessions /root/.local/bin /root/.config /usr/local/bin /data/bin

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

# 2. Restore CLI binary symlinks
ln -sfn /data/hermes/.hermes/installs/8a4017c4cabfe15f/environments/5b3526e22336490dac2bb79381a4c7af/venv /data/hermes/.hermes/hermes-agent/venv
ln -sfn /data/hermes/.hermes/hermes-agent/hermes_cli/web_dist /data/hermes/.hermes/installs/8a4017c4cabfe15f/environments/5b3526e22336490dac2bb79381a4c7af/workspace/hermes_cli/web_dist
chmod +x /data/hermes/.hermes/hermes-agent/venv/bin/hermes /data/hermes/sync_to_data.py /data/hermes/vm_bridge.py /data/bin/cloudflared 2>/dev/null || true
ln -sfn /data/bin/cloudflared /usr/local/bin/cloudflared 2>/dev/null || true
ln -sfn /data/hermes/.hermes/hermes-agent/venv/bin/hermes /data/bin/hermes
ln -sfn /data/hermes/.hermes/hermes-agent/venv/bin/hermes /usr/local/bin/hermes
ln -sfn /data/hermes/.hermes/hermes-agent/venv/bin/hermes /root/.local/bin/hermes

# 3. Install and start systemd services
cp -f /data/hermes/hermes-dashboard.service /etc/systemd/system/hermes-dashboard.service
cp -f /data/hermes/hermes-sync.service /etc/systemd/system/hermes-sync.service
cp -f /data/hermes/hermes-bridge.service /etc/systemd/system/hermes-bridge.service
systemctl daemon-reload
systemctl enable hermes-dashboard.service hermes-sync.service hermes-bridge.service
systemctl restart hermes-dashboard.service hermes-sync.service hermes-bridge.service

echo "[hermes-boot] Hermes Agent services active and synced on /data/hermes."
