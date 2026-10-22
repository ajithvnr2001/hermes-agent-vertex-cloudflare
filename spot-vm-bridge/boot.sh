#!/usr/bin/env bash
# ==============================================================================
# /data/hermes/boot.sh — Automatic Spot VM Reallocation & Reboot Recovery
# Restores all Hermes Agent symlinks, CLI binaries, and systemd services from /data
# ==============================================================================
set -e

HERMES_DATA_DIR="${HERMES_DATA_DIR:-/data/hermes}"
echo "[hermes-boot] Restoring Hermes Agent from persistent disk ${HERMES_DATA_DIR}..."

mkdir -p "${HERMES_DATA_DIR}/storage/sessions" \
         "${HERMES_DATA_DIR}/logs" \
         /root/.local/bin /root/.config /usr/local/bin /data/bin

# 1. Restore directory symlinks
if [ ! -L /root/.hermes ]; then
  rm -rf /root/.hermes
  ln -s "${HERMES_DATA_DIR}/.hermes" /root/.hermes
fi
for user_dir in /home/*; do
  if [ -d "$user_dir" ]; then
    ln -sfn "${HERMES_DATA_DIR}/.hermes" "${user_dir}/.hermes" 2>/dev/null || true
  fi
done

if [ -d "${HERMES_DATA_DIR}/hermes-cloudflare-web" ] && [ ! -L /root/hermes-cloudflare-web ]; then
  rm -rf /root/hermes-cloudflare-web
  ln -s "${HERMES_DATA_DIR}/hermes-cloudflare-web" /root/hermes-cloudflare-web
fi

if [ -d "${HERMES_DATA_DIR}/.wrangler" ]; then
  if [ ! -L /root/.wrangler ]; then
    rm -rf /root/.wrangler
    ln -s "${HERMES_DATA_DIR}/.wrangler" /root/.wrangler
  fi
  ln -sfn "${HERMES_DATA_DIR}/.wrangler" /root/.config/.wrangler
fi

# 2. Dynamically locate and restore Hermes CLI virtualenv symlinks
mkdir -p "${HERMES_DATA_DIR}/.hermes/hermes-agent"
if [ ! -x "${HERMES_DATA_DIR}/.hermes/hermes-agent/venv/bin/hermes" ]; then
  DETECTED_VENV=$(find "${HERMES_DATA_DIR}/.hermes" -maxdepth 5 -type d -name "venv" 2>/dev/null | head -n 1 || true)
  if [ -n "$DETECTED_VENV" ]; then
    ln -sfn "$DETECTED_VENV" "${HERMES_DATA_DIR}/.hermes/hermes-agent/venv"
    DETECTED_WS="$(dirname "$DETECTED_VENV")/workspace/hermes_cli"
    if [ -d "$DETECTED_WS" ] && [ -d "${HERMES_DATA_DIR}/.hermes/hermes-agent/hermes_cli/web_dist" ]; then
      ln -sfn "${HERMES_DATA_DIR}/.hermes/hermes-agent/hermes_cli/web_dist" "${DETECTED_WS}/web_dist"
    fi
  fi
fi

chmod +x "${HERMES_DATA_DIR}/.hermes/hermes-agent/venv/bin/hermes" \
         "${HERMES_DATA_DIR}/sync_to_data.py" \
         "${HERMES_DATA_DIR}/vm_bridge.py" \
         /data/bin/cloudflared 2>/dev/null || true

ln -sfn /data/bin/cloudflared /usr/local/bin/cloudflared 2>/dev/null || true
if [ -x "${HERMES_DATA_DIR}/.hermes/hermes-agent/venv/bin/hermes" ]; then
  ln -sfn "${HERMES_DATA_DIR}/.hermes/hermes-agent/venv/bin/hermes" /data/bin/hermes
  ln -sfn "${HERMES_DATA_DIR}/.hermes/hermes-agent/venv/bin/hermes" /usr/local/bin/hermes
  ln -sfn "${HERMES_DATA_DIR}/.hermes/hermes-agent/venv/bin/hermes" /root/.local/bin/hermes
fi

# 3. Install and start systemd services
for svc in hermes-dashboard.service hermes-sync.service hermes-bridge.service; do
  if [ -f "${HERMES_DATA_DIR}/${svc}" ]; then
    cp -f "${HERMES_DATA_DIR}/${svc}" "/etc/systemd/system/${svc}"
  elif [ -f "${HERMES_DATA_DIR}/systemd/${svc}" ]; then
    cp -f "${HERMES_DATA_DIR}/systemd/${svc}" "/etc/systemd/system/${svc}"
  fi
done

systemctl daemon-reload
systemctl enable hermes-dashboard.service hermes-sync.service hermes-bridge.service 2>/dev/null || true
systemctl restart hermes-dashboard.service hermes-sync.service hermes-bridge.service 2>/dev/null || true

echo "[hermes-boot] Hermes Agent services active and synced on ${HERMES_DATA_DIR}."
