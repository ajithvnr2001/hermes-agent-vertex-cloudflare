#!/usr/bin/env bash
# ==============================================================================
# scripts/setup-spot-vm.sh — One-Command Spot VM / General Linux VM Installer
# Sets up /data/hermes persistent storage, cloudflared, NousResearch Hermes Agent,
# vm_bridge.py, sync_to_data.py, boot.sh, systemd services, and @reboot cron.
# ==============================================================================
set -euo pipefail

HERMES_DATA_DIR="${HERMES_DATA_DIR:-/data/hermes}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=================================================================="
echo " ☤ Hermes Agent — Spot VM / General VM Persistent Setup (${HERMES_DATA_DIR})"
echo "=================================================================="

# 1. Create persistent directories on /data
mkdir -p "${HERMES_DATA_DIR}/.hermes" \
         "${HERMES_DATA_DIR}/storage/sessions" \
         "${HERMES_DATA_DIR}/storage/scratch" \
         "${HERMES_DATA_DIR}/logs" \
         /data/bin /usr/local/bin

ln -sfn "${HERMES_DATA_DIR}/.hermes" /root/.hermes

# 2. Install cloudflared to /data/bin/cloudflared if not present
if [ ! -x /data/bin/cloudflared ]; then
  echo "[1/5] Downloading cloudflared binary to /data/bin/cloudflared..."
  ARCH="$(uname -m)"
  CF_ARCH="amd64"
  if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    CF_ARCH="arm64"
  fi
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
    -o /data/bin/cloudflared
  chmod +x /data/bin/cloudflared
fi
ln -sfn /data/bin/cloudflared /usr/local/bin/cloudflared

# 3. Install NousResearch Hermes Agent into /data/hermes/.hermes if not already installed
if [ ! -x "${HERMES_DATA_DIR}/.hermes/hermes-agent/venv/bin/hermes" ] && [ -z "$(find "${HERMES_DATA_DIR}/.hermes" -maxdepth 5 -name hermes -type f 2>/dev/null | head -n 1)" ]; then
  echo "[2/5] Installing NousResearch Hermes Agent into ${HERMES_DATA_DIR}/.hermes..."
  export HERMES_HOME="${HERMES_DATA_DIR}/.hermes"
  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash || true
else
  echo "[2/5] Hermes Agent CLI already present in ${HERMES_DATA_DIR}/.hermes."
fi

# 4. Copy bridge, sync daemon, boot script, and systemd units to /data/hermes
echo "[3/5] Installing Spot VM Bridge, SQLite Sync Daemon, and Systemd units..."
cp -f "${REPO_ROOT}/spot-vm-bridge/vm_bridge.py" "${HERMES_DATA_DIR}/vm_bridge.py"
cp -f "${REPO_ROOT}/spot-vm-bridge/sync_to_data.py" "${HERMES_DATA_DIR}/sync_to_data.py"
cp -f "${REPO_ROOT}/spot-vm-bridge/boot.sh" "${HERMES_DATA_DIR}/boot.sh"
cp -f "${REPO_ROOT}/spot-vm-bridge/systemd/"*.service "${HERMES_DATA_DIR}/"
chmod +x "${HERMES_DATA_DIR}/vm_bridge.py" "${HERMES_DATA_DIR}/sync_to_data.py" "${HERMES_DATA_DIR}/boot.sh"

if [ ! -f "${HERMES_DATA_DIR}/.env" ]; then
  cp "${REPO_ROOT}/.env.example" "${HERMES_DATA_DIR}/.env"
  echo "  -> Created ${HERMES_DATA_DIR}/.env from .env.example (edit with your Worker URL & credentials)."
fi

# 5. Run boot.sh and register @reboot cron job
echo "[4/5] Running ${HERMES_DATA_DIR}/boot.sh to enable systemd services..."
"${HERMES_DATA_DIR}/boot.sh"

echo "[5/5] Registering @reboot recovery hook in root crontab..."
(crontab -l 2>/dev/null | grep -v "${HERMES_DATA_DIR}/boot.sh" || true; echo "@reboot ${HERMES_DATA_DIR}/boot.sh >> ${HERMES_DATA_DIR}/logs/boot.log 2>&1") | crontab -

echo "=================================================================="
echo " ✅ Spot VM Setup Complete!"
echo " Next: Edit ${HERMES_DATA_DIR}/.env with your HERMES_WORKER_URL,"
echo " HERMES_AUTH_USER, HERMES_AUTH_PASSWORD, and HERMES_BRIDGE_SECRET,"
echo " then run: systemctl restart hermes-bridge hermes-sync"
echo "=================================================================="
