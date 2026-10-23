#!/usr/bin/env bash
# ==============================================================================
# scripts/setup-spot-vm.sh — One-Command New VM / Spot VM End-to-End Installer
# Sets up:
#   1. Persistent directories & symlinks on /data/hermes
#   2. cloudflared binary (/data/bin/cloudflared)
#   3. NousResearch Hermes Agent CLI + Python venv (/data/hermes/.hermes)
#   4. River AI (5 models) + Google Vertex AI (15 Gemini models) + 10-provider
#      fallback chain + proactive context compaction (config.template.yaml)
#   5. Vertex AI HTTP 429 adaptive backoff & auto-recovery patches (agent/*.py)
#   6. Playwright + ScrapeGraphAI + Scrapling + Exa skill
#   7. Systemd services (hermes-gateway, hermes-dashboard, hermes-bridge) + @reboot
# ==============================================================================
set -euo pipefail

HERMES_DATA_DIR="${HERMES_DATA_DIR:-/data/hermes}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=================================================================="
echo " ☤ Hermes Agent — End-to-End VM Setup (${HERMES_DATA_DIR})"
echo "=================================================================="

# 1. Create persistent directories on /data
mkdir -p "${HERMES_DATA_DIR}/.hermes" \
         "${HERMES_DATA_DIR}/storage/sessions" \
         "${HERMES_DATA_DIR}/storage/scratch" \
         "${HERMES_DATA_DIR}/logs" \
         "${HERMES_DATA_DIR}/.cache/ms-playwright" \
         "${HERMES_DATA_DIR}/tools" \
         /data/bin /usr/local/bin /root/.local/bin

ln -sfn "${HERMES_DATA_DIR}/.hermes" /root/.hermes
ln -sfn "${HERMES_DATA_DIR}/.cache/ms-playwright" /root/.cache/ms-playwright

# 2. Install cloudflared to /data/bin/cloudflared if not present
if [ ! -x /data/bin/cloudflared ]; then
  echo "[1/7] Downloading cloudflared binary to /data/bin/cloudflared..."
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
  echo "[2/7] Installing NousResearch Hermes Agent into ${HERMES_DATA_DIR}/.hermes..."
  export HERMES_HOME="${HERMES_DATA_DIR}/.hermes"
  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash || true
else
  echo "[2/7] Hermes Agent CLI already present in ${HERMES_DATA_DIR}/.hermes."
fi

# 4. Apply Vertex AI HTTP 429 backoff & auto-recovery patches across all Hermes environments
echo "[3/7] Applying Vertex AI HTTP 429 adaptive backoff & auto-recovery patches..."
HA_DIR="${HERMES_DATA_DIR}/.hermes/hermes-agent"
if [ -d "${HA_DIR}/agent" ] && [ -d "${REPO_ROOT}/spot-vm-bridge/patches/agent" ]; then
  cp -f "${REPO_ROOT}/spot-vm-bridge/patches/agent/"*.py "${HA_DIR}/agent/"
fi
for env_ws in "${HERMES_DATA_DIR}"/.hermes/installs/*/environments/*/workspace; do
  if [ -d "${env_ws}/agent" ] && [ -d "${REPO_ROOT}/spot-vm-bridge/patches/agent" ]; then
    cp -f "${REPO_ROOT}/spot-vm-bridge/patches/agent/"*.py "${env_ws}/agent/"
  fi
done

# 5. Install config.yaml (if not present) from config.template.yaml and .env
echo "[4/7] Configuring River AI, Google Vertex AI, 10-provider fallback chain & compaction..."
if [ ! -f "${HERMES_DATA_DIR}/.env" ]; then
  cp "${REPO_ROOT}/.env.example" "${HERMES_DATA_DIR}/.env"
  echo "  -> Created ${HERMES_DATA_DIR}/.env from .env.example."
fi
if [ ! -f "${HERMES_DATA_DIR}/.hermes/config.yaml" ] && [ -f "${REPO_ROOT}/spot-vm-bridge/config.template.yaml" ]; then
  cp "${REPO_ROOT}/spot-vm-bridge/config.template.yaml" "${HERMES_DATA_DIR}/.hermes/config.yaml"
  echo "  -> Installed ${HERMES_DATA_DIR}/.hermes/config.yaml from config.template.yaml."
fi

# 6. Copy skills, tools, scripts, and systemd units to /data/hermes
echo "[5/7] Installing skills, tools, tunnel scripts, and systemd units..."
mkdir -p "${HERMES_DATA_DIR}/.hermes/skills/exa-playwright-scrapegraph-scrapling"
cp -f "${REPO_ROOT}/skills/exa-playwright-scrapegraph-scrapling/SKILL.md" \
      "${HERMES_DATA_DIR}/.hermes/skills/exa-playwright-scrapegraph-scrapling/SKILL.md" 2>/dev/null || true
cp -f "${REPO_ROOT}/tools/exa_scraper_suite.py" "${HERMES_DATA_DIR}/tools/exa_scraper_suite.py" 2>/dev/null || true
cp -f "${REPO_ROOT}/spot-vm-bridge/vm_bridge.py" "${HERMES_DATA_DIR}/vm_bridge.py"
cp -f "${REPO_ROOT}/spot-vm-bridge/sync_to_data.py" "${HERMES_DATA_DIR}/sync_to_data.py"
cp -f "${REPO_ROOT}/spot-vm-bridge/start-tunnel.sh" "${HERMES_DATA_DIR}/start-tunnel.sh"
cp -f "${REPO_ROOT}/spot-vm-bridge/boot.sh" "${HERMES_DATA_DIR}/boot.sh"
cp -f "${REPO_ROOT}/spot-vm-bridge/systemd/"*.service "${HERMES_DATA_DIR}/"
chmod +x "${HERMES_DATA_DIR}/vm_bridge.py" "${HERMES_DATA_DIR}/sync_to_data.py" \
         "${HERMES_DATA_DIR}/start-tunnel.sh" "${HERMES_DATA_DIR}/boot.sh"

# 7. Run boot.sh and register @reboot cron job
echo "[6/7] Running ${HERMES_DATA_DIR}/boot.sh to enable and start systemd services..."
"${HERMES_DATA_DIR}/boot.sh"

echo "[7/7] Registering @reboot recovery hook in root crontab..."
(crontab -l 2>/dev/null | grep -v "${HERMES_DATA_DIR}/boot.sh" || true; echo "@reboot ${HERMES_DATA_DIR}/boot.sh >> ${HERMES_DATA_DIR}/logs/boot.log 2>&1") | crontab -

echo "=================================================================="
echo " ✅ New VM Setup Complete!"
echo " 1. Put your RIVER_API_KEY, GOOGLE_API_KEY, and TELEGRAM_BOT_TOKEN"
echo "    in ${HERMES_DATA_DIR}/.hermes/.env"
echo " 2. Restart services: systemctl restart hermes-gateway hermes-dashboard"
echo " 3. Verify fallback chain: hermes fallback list"
echo "=================================================================="
