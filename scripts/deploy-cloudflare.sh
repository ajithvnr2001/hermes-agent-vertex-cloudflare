#!/usr/bin/env bash
# ==============================================================================
# scripts/deploy-cloudflare.sh — One-Command Cloudflare Edge Deployment Helper
# Validates worker syntax, creates R2/D1 resources if needed, applies schema.sql,
# and deploys the Cloudflare Worker.
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="${REPO_ROOT}/cloudflare-worker"

echo "=================================================================="
echo " ☁️ Hermes Agent — Cloudflare Worker + R2 + D1 Deployment"
echo "=================================================================="

cd "$WORKER_DIR"

echo "[1/4] Validating Cloudflare Worker JavaScript syntax..."
node --check src/index.js
node --check src/tools.js
node --check src/ui.js
echo "  -> Syntax OK."

echo "[2/4] Ensuring R2 bucket 'hermes-agent-storage' exists..."
npx wrangler r2 bucket create hermes-agent-storage 2>/dev/null || echo "  -> R2 bucket 'hermes-agent-storage' already exists or ready."

echo "[3/4] Initializing D1 database schema (if D1 database_id is configured)..."
if ! grep -q "YOUR_D1_DATABASE_ID" wrangler.toml; then
  npx wrangler d1 execute hermes-agent-db --remote --file=schema.sql || true
else
  echo "  -> Note: Replace YOUR_D1_DATABASE_ID in cloudflare-worker/wrangler.toml after running 'npx wrangler d1 create hermes-agent-db'."
fi

echo "[4/4] Deploying Cloudflare Worker..."
npx wrangler deploy

echo "=================================================================="
echo " ✅ Cloudflare Worker Deployed Successfully!"
echo "=================================================================="
