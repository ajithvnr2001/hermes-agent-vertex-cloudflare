# Complete Beginner-to-Production Setup Guide: Hermes Agent + Google Vertex AI (All Gemini Models) + River AI + 10-Provider Fallback + Spot VM Persistence (`docs/DEPLOYMENT_GUIDE.md`)

This guide provides **minute-level, copy-pasteable, beginner-friendly instructions** to set up **Hermes Agent** from scratch on a brand-new Linux VM (Spot VM or Standard VM on Azure, GCP, AWS, Hetzner, or bare-metal) with:
1. **Persistent `/data/hermes` Storage** (survives Spot VM preemptions, reboots, and OS re-imaging).
2. **All Google Cloud Vertex AI Gemini Models** (`gemini-4-argon`, `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview`, `gemini-3.1-pro-preview-customtools`, `gemini-3.1-flash-lite`, `gemini-3-flash-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, plus `gemini-3.8-flash-tts` / `gemini-3.8-flash-lite-tts` for speech).
3. **River AI Custom Endpoint (`https://api.river.ai/v1`)** — Automatic discovery and verification of all River AI models (`deepseek-ai/DeepSeek-V4.1-Flash`, `deepseek-ai/DeepSeek-V4.1-Flash-1017`, `zai-org/GLM-5.3-Flash`, `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4`, `Qwen/Qwen3.8-27B-FP8`).
4. **10-Provider Automatic Fallback Chain (`fallback_providers`)** — Zero-downtime failover across River AI and Vertex AI models if any model is rate-limited (`HTTP 429`) or temporarily unavailable.
5. **Proactive Context Compaction & Auxiliary Task Offloading** — Automatic tool-output pruning at `36k` tokens, context summarization at `90k` tokens, and background memory/skill review offloaded to River AI (`deepseek-ai/DeepSeek-V4.1-Flash`) so background housekeeping consumes **zero** primary Vertex AI quota.
6. **Vertex AI `HTTP 429` Adaptive Backoff & Multi-Cycle Auto-Recovery Patches** (`retry_utils.py`, `turn_recovery_autorecover.py`, `turn_api_error.py`).
7. **Telegram Bot Gateway (`hermes-gateway.service`)** + **Native Web Dashboard (`hermes-dashboard.service` on `127.0.0.1:9119`)** + **Exa MCP & Scraping Suite (`Playwright`, `ScrapeGraphAI`, `Scrapling`)**.

---

## Step 0: Install System Prerequisites on a Brand-New Ubuntu/Debian VM

SSH into your new VM as `root` (or run `sudo -i`) and install the required system packages, Node.js 20+, and Google Cloud CLI (`gcloud`):

```bash
sudo -i
apt-get update && apt-get install -y \
  curl wget git jq sqlite3 ffmpeg build-essential python3 python3-venv python3-pip \
  ca-certificates gnupg lsb-release apt-transport-https

# Install Node.js 20 LTS (if not installed)
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Install Google Cloud SDK (gcloud) if not installed
if ! command -v gcloud >/dev/null 2>&1; then
  curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    > /etc/apt/sources.list.d/google-cloud-sdk.list
  apt-get update && apt-get install -y google-cloud-cli
fi
```

---

## Step 1: Mount Your Persistent Disk at `/data` (Spot VM Survival)

 keeping all files on `/data/hermes` ensures that even if a Spot VM is evicted or its OS disk is recreated, nothing is lost.

```bash
# 1. Check attached disks
lsblk -f

# 2. Create /data mount point (if you have a separate data disk, format once and mount it)
mkdir -p /data
# Example if mounting /dev/sdb1:
# UUID=$(blkid -s UUID -o value /dev/sdb1)
# grep -q "/data" /etc/fstab || echo "UUID=${UUID} /data ext4 defaults,nofail,x-systemd.device-timeout=10 0 2" >> /etc/fstab
# mount -a

# 3. Create persistent directory structure on /data/hermes
mkdir -p /data/hermes/.hermes \
         /data/hermes/storage/sessions \
         /data/hermes/logs \
         /data/hermes/.cache/ms-playwright \
         /data/bin \
         /root/.local/bin

# 4. Symlink /root/.hermes -> /data/hermes/.hermes BEFORE installing Hermes Agent
rm -rf /root/.hermes
ln -sfn /data/hermes/.hermes /root/.hermes
```

---

## Step 2: Clone This Repository & Install Hermes Agent Core onto `/data/hermes`

```bash
# 1. Clone this repository onto the persistent disk
git clone https://github.com/ajithvnr2001/hermes-agent-vertex-cloudflare.git /data/hermes/hermes-agent-vertex-cloudflare-repo

# 2. Install NousResearch Hermes Agent into /data/hermes/.hermes
export HERMES_HOME="/data/hermes/.hermes"
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# 3. Ensure the hermes binary is on PATH everywhere
ln -sfn /data/hermes/.hermes/hermes-agent/venv/bin/hermes /usr/local/bin/hermes
ln -sfn /data/hermes/.hermes/hermes-agent/venv/bin/hermes /root/.local/bin/hermes
ln -sfn /data/hermes/.hermes/hermes-agent/venv/bin/hermes /data/bin/hermes
export PATH="/root/.local/bin:/usr/local/bin:/data/bin:$PATH"

# Verify CLI works
hermes --version
```

---

## Step 3: Configure Google Cloud Vertex AI (All 15 Gemini Models)

Hermes accesses Gemini models through **three complementary paths** on your Google Cloud project (`genai-512407` or your own GCP Project ID):

### 3.1 How the 3 Gemini Access Paths Work

| Access Path | Provider Name | Endpoint | Auth Used | Models Supported |
|---|---|---|---|---|
| **Path A: Vertex OpenAI-Compatible API** | `vertex` | `https://aiplatform.googleapis.com/v1beta1/projects/<PROJECT_ID>/locations/global/endpoints/openapi` | Google OAuth2 / ADC (`gcloud auth` -> `ya29...` token) | All 13 `google/gemini-*` chat models |
| **Path B: Gemini Native Adapter** | `gemini` | `https://aiplatform.googleapis.com/v1beta1/projects/<PROJECT_ID>/locations/global` | `GOOGLE_API_KEY` / `GEMINI_API_KEY` (`AQ...` Vertex Express key) | All 13 bare `gemini-*` chat models |
| **Path C: Direct `:generateContent` REST** | Skill / Script | `https://aiplatform.googleapis.com/v1/projects/<PROJECT_ID>/locations/global/publishers/google/models/<MODEL>:generateContent` | `gcloud auth print-access-token` | `gemini-3.8-flash-lite-tts` & `gemini-3.8-flash-tts` (Audio/Speech) |

### 3.2 Authenticate `gcloud` & Application Default Credentials (ADC)

Run these commands to authenticate your Google Cloud account and enable Vertex AI:

```bash
export GCP_PROJECT_ID="genai-512407"   # Replace with your GCP project ID if different

# 1. Log in to gcloud (prints a URL you can open in any browser)
gcloud auth login --no-launch-browser

# 2. Set Application Default Credentials (used by Hermes provider: vertex)
gcloud auth application-default login --no-launch-browser

# 3. Set active project and enable Vertex AI API
gcloud config set project "$GCP_PROJECT_ID"
gcloud services enable aiplatform.googleapis.com --project="$GCP_PROJECT_ID"

# 4. Verify token generation works
gcloud auth print-access-token | head -c 20 && echo " (OK)"
```

### 3.3 Full List of Gemini Models Available in Hermes

Once configured, all of the following Gemini models are available via `/model`:
- `google/gemini-4-argon` (Default flagship model)
- `google/gemini-3.8-flash`
- `google/gemini-3.7-flash`
- `google/gemini-3.6-flash`
- `google/gemini-3.5-flash`
- `google/gemini-3.5-flash-lite`
- `google/gemini-3.1-pro-preview`
- `google/gemini-3.1-pro-preview-customtools`
- `google/gemini-3.1-flash-lite`
- `google/gemini-3-flash-preview`
- `google/gemini-2.5-pro`
- `google/gemini-2.5-flash`
- `google/gemini-2.5-flash-lite`
- **TTS Speech Models (via `:generateContent`):** `gemini-3.8-flash-lite-tts`, `gemini-3.8-flash-tts`

---

## Step 4: Configure River AI (`https://api.river.ai/v1`) & Fetch All Models

River AI provides an OpenAI-compatible endpoint at `https://api.river.ai/v1`.

### 4.1 Add Credentials to `/data/hermes/.hermes/.env`

```bash
cat << 'EOF' >> /data/hermes/.hermes/.env

# =============================================================================
# LLM PROVIDER (Google Cloud Vertex AI / Gemini)
# =============================================================================
GOOGLE_API_KEY=YOUR_GOOGLE_VERTEX_EXPRESS_API_KEY
GEMINI_API_KEY=YOUR_GOOGLE_VERTEX_EXPRESS_API_KEY
GEMINI_BASE_URL=https://aiplatform.googleapis.com/v1beta1/projects/genai-512407/locations/global
VERTEX_PROJECT_ID=genai-512407
VERTEX_REGION=global

# =============================================================================
# LLM PROVIDER (River AI)
# =============================================================================
RIVER_API_KEY=rv_YOUR_RIVER_API_KEY
RIVER_BASE_URL=https://api.river.ai/v1

# =============================================================================
# TELEGRAM BOT INTEGRATION
# =============================================================================
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
TELEGRAM_ALLOWED_USERS=YOUR_TELEGRAM_USER_ID
EOF
```

### 4.2 Fetch & Test All Available Models from River AI (`GET /v1/models`)

Run this script using Hermes's Python environment to dynamically query `https://api.river.ai/v1/models` and test both chat completions and tool calling on every returned model:

```bash
/data/hermes/.hermes/hermes-agent/venv/bin/python - << 'EOF'
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv("/data/hermes/.hermes/.env")
api_key = os.environ["RIVER_API_KEY"]
base_url = os.environ.get("RIVER_BASE_URL", "https://api.river.ai/v1")

client = OpenAI(base_url=base_url, api_key=api_key, timeout=30.0)

print(f"Fetching models from {base_url}/models ...")
models = [m.id for m in client.models.list().data]
print(f"Discovered {len(models)} River AI models:")
for idx, model_id in enumerate(models, 1):
    res = client.chat.completions.create(
        model=model_id,
        messages=[{"role": "user", "content": "Reply with OK"}],
        max_tokens=16,
    )
    reply = (res.choices[0].message.content or "").strip()
    print(f"  {idx}. {model_id} -> {reply!r}")
EOF
```

**Expected Output (5 Verified Models):**
1. `deepseek-ai/DeepSeek-V4.1-Flash`
2. `deepseek-ai/DeepSeek-V4.1-Flash-1017`
3. `zai-org/GLM-5.3-Flash`
4. `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4`
5. `Qwen/Qwen3.8-27B-FP8`

---

## Step 5: Install `config.yaml` (River AI Provider + 10-Provider Fallback Chain + Proactive Compaction)

 This repository includes a ready-to-use template at [`spot-vm-bridge/config.template.yaml`](../spot-vm-bridge/config.template.yaml) that configures:
1. **`model`**: Primary model `google/gemini-4-argon` on `vertex`.
2. **`providers.river`**: Registers River AI (`https://api.river.ai/v1`) and all 5 discovered models so you can switch to any of them anytime via `/model`.
3. **`fallback_providers` (10 entries)**:
   - `#1–#5`: All 5 River AI models (`deepseek-ai/DeepSeek-V4.1-Flash`, `zai-org/GLM-5.3-Flash`, `Qwen/Qwen3.8-27B-FP8`, `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4`, `deepseek-ai/DeepSeek-V4.1-Flash-1017`) with `reasoning_echo: true`.
   - `#6–#10`: 5 Vertex AI models (`google/gemini-3.1-pro-preview`, `google/gemini-3-flash-preview`, `google/gemini-3.8-flash`, `openai/gpt-oss-120b-maas`, `google/gemini-4-argon`).
4. **Proactive Compaction (`compression`)**:
   - `proactive_prune_tokens: 36000` (trims bulky historical tool outputs automatically at 36k tokens without waiting for full summarization).
   - `threshold: 0.1` & `threshold_tokens: 90000` (triggers full context summarization at 90k tokens instead of waiting for 50% of 1M = 500k tokens, which previously caused Vertex AI `HTTP 429` TPM rate limits).
   - `idle_compact_after_seconds: 120` (compacts sessions after 2 minutes of idle time).
5. **Auxiliary Task Offloading (`auxiliary`)**:
   - Routes `background_review`, `compression`, `session_search`, `skills_hub`, `approval`, `mcp`, and `flush_memories` to `deepseek-ai/DeepSeek-V4.1-Flash` on River AI (`https://api.river.ai/v1`). Background memory/skill reviews never touch your primary Vertex AI quota!

### Generate `/data/hermes/.hermes/config.yaml` from the Template

```bash
set -a
source /data/hermes/.hermes/.env
set +a

export EXA_API_KEY="${EXA_API_KEY:-your_exa_api_key}"

envsubst '${RIVER_API_KEY} ${EXA_API_KEY}' \
  < /data/hermes/hermes-agent-vertex-cloudflare-repo/spot-vm-bridge/config.template.yaml \
  > /data/hermes/.hermes/config.yaml
```

Verify the fallback chain is recognized by Hermes:

```bash
hermes fallback list
```

Expected output:
```text
  Primary:   google/gemini-4-argon  (via vertex)

  Fallback chain (10 entries):
    1. deepseek-ai/DeepSeek-V4.1-Flash  (via river)  [https://api.river.ai/v1]
    2. zai-org/GLM-5.3-Flash  (via river)  [https://api.river.ai/v1]
    3. Qwen/Qwen3.8-27B-FP8  (via river)  [https://api.river.ai/v1]
    4. nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4  (via river)  [https://api.river.ai/v1]
    5. deepseek-ai/DeepSeek-V4.1-Flash-1017  (via river)  [https://api.river.ai/v1]
    6. google/gemini-3.1-pro-preview  (via vertex)
    7. google/gemini-3-flash-preview  (via vertex)
    8. google/gemini-3.8-flash  (via vertex)
    9. openai/gpt-oss-120b-maas  (via vertex)
   10. google/gemini-4-argon  (via vertex)
```

---

## Step 6: Apply Vertex AI `HTTP 429` Adaptive Backoff & Auto-Recovery Patches

By default, Hermes retries rate-limit errors (`HTTP 429`) 3 times within ~6 seconds (too short for Vertex AI's 60-second sliding TPM window) and excludes `rate_limit` from its multi-cycle auto-recovery ladder.

Copy the 3 patched files from [`spot-vm-bridge/patches/agent/`](../spot-vm-bridge/patches/agent/) into your Hermes installation:

```bash
REPO="/data/hermes/hermes-agent-vertex-cloudflare-repo"
HA_DIR="/data/hermes/.hermes/hermes-agent"

# 1. Copy to main hermes-agent checkout
cp -f "$REPO/spot-vm-bridge/patches/agent/retry_utils.py" "$HA_DIR/agent/retry_utils.py"
cp -f "$REPO/spot-vm-bridge/patches/agent/turn_recovery_autorecover.py" "$HA_DIR/agent/turn_recovery_autorecover.py"
cp -f "$REPO/spot-vm-bridge/patches/agent/turn_api_error.py" "$HA_DIR/agent/turn_api_error.py"

# 2. Copy to all active uv/venv workspace environments under /data/hermes/.hermes/installs
for env_ws in /data/hermes/.hermes/installs/*/environments/*/workspace; do
  if [ -d "$env_ws/agent" ]; then
    cp -f "$REPO/spot-vm-bridge/patches/agent/retry_utils.py" "$env_ws/agent/retry_utils.py"
    cp -f "$REPO/spot-vm-bridge/patches/agent/turn_recovery_autorecover.py" "$env_ws/agent/turn_recovery_autorecover.py"
    cp -f "$REPO/spot-vm-bridge/patches/agent/turn_api_error.py" "$env_ws/agent/turn_api_error.py"
    echo "Patched: $env_ws/agent"
  fi
done
```

What these 3 patches do:
- [`retry_utils.py`](../spot-vm-bridge/patches/agent/retry_utils.py): Detects Vertex AI (`aiplatform.googleapis.com`) 429s and spaces retries out (`8s -> 16s -> 32s -> 45s`) across Vertex's 60-second TPM window.
- [`turn_recovery_autorecover.py`](../spot-vm-bridge/patches/agent/turn_recovery_autorecover.py): Adds `FailoverReason.rate_limit` and `FailoverReason.upstream_rate_limit` to `_LADDER_REASONS` so if all retries and fallbacks are temporarily exhausted, Hermes enters its `15s -> 30s -> 60s` auto-recovery wait ladder instead of aborting the turn.
- [`turn_api_error.py`](../spot-vm-bridge/patches/agent/turn_api_error.py): Resets `agent._fallback_index = 0` and `_retry.has_retried_429 = False` between auto-recovery cycles so the full fallback chain is re-walked cleanly.

---

## Step 7: Install Playwright, ScrapeGraphAI, Scrapling & Custom Scraper Skill

```bash
# Install scraping libraries into Hermes's Python venv
/data/hermes/.hermes/hermes-agent/venv/bin/pip install playwright scrapegraphai scrapling html2text

# Install headless Chromium onto persistent /data/hermes/.cache/ms-playwright
export PLAYWRIGHT_BROWSERS_PATH="/data/hermes/.cache/ms-playwright"
ln -sfn /data/hermes/.cache/ms-playwright /root/.cache/ms-playwright
/data/hermes/.hermes/hermes-agent/venv/bin/playwright install --with-deps chromium

# Copy the Exa + Playwright + ScrapeGraphAI + Scrapling skill and tool into /data/hermes/.hermes
mkdir -p /data/hermes/.hermes/skills/exa-playwright-scrapegraph-scrapling /data/hermes/tools
cp -f "$REPO/skills/exa-playwright-scrapegraph-scrapling/SKILL.md" \
      /data/hermes/.hermes/skills/exa-playwright-scrapegraph-scrapling/SKILL.md
cp -f "$REPO/tools/exa_scraper_suite.py" /data/hermes/tools/exa_scraper_suite.py
```

---

## Step 8: Install & Start Systemd Services (`hermes-gateway`, `hermes-dashboard`, `hermes-bridge`) & `@reboot` Auto-Recovery

Or simply run `sudo bash /data/hermes/hermes-agent-vertex-cloudflare-repo/scripts/setup-spot-vm.sh` to automate Steps 5–8!

To run manually:

```bash
REPO="/data/hermes/hermes-agent-vertex-cloudflare-repo"

# 1. Copy boot script, tunnel script, and systemd units to /data/hermes
cp -f "$REPO/spot-vm-bridge/boot.sh" /data/hermes/boot.sh
cp -f "$REPO/spot-vm-bridge/start-tunnel.sh" /data/hermes/start-tunnel.sh
cp -f "$REPO/spot-vm-bridge/systemd/hermes-gateway.service" /data/hermes/hermes-gateway.service
cp -f "$REPO/spot-vm-bridge/systemd/hermes-dashboard.service" /data/hermes/hermes-dashboard.service
cp -f "$REPO/spot-vm-bridge/systemd/hermes-bridge.service" /data/hermes/hermes-bridge.service
chmod +x /data/hermes/boot.sh /data/hermes/start-tunnel.sh

# 2. Install cloudflared binary to /data/bin/cloudflared
if [ ! -x /data/bin/cloudflared ]; then
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /data/bin/cloudflared
  chmod +x /data/bin/cloudflared
  ln -sfn /data/bin/cloudflared /usr/local/bin/cloudflared
fi

# 3. Execute boot.sh (installs & starts systemd services)
/data/hermes/boot.sh

# 4. Register @reboot cron hook so everything self-heals on VM reboot
(crontab -l 2>/dev/null | grep -v '/data/hermes/boot.sh' || true; \
 echo '@reboot /data/hermes/boot.sh >> /data/hermes/logs/boot.log 2>&1') | crontab -
```

---

## Step 9: Post-Setup Verification Checklist

Run these 4 commands to verify everything is live and healthy:

```bash
# 1. Check systemd services are active
systemctl is-active hermes-gateway.service hermes-dashboard.service hermes-bridge.service

# 2. Verify all 10 fallback providers (5 River AI + 5 Vertex AI)
hermes fallback list

# 3. Check native web dashboard & Telegram connection status on port 9119
curl -s http://127.0.0.1:9119/api/status | jq .

# 4. Test a direct River AI completion from the CLI environment
/data/hermes/.hermes/hermes-agent/venv/bin/python -c '
import os
from dotenv import load_dotenv
from openai import OpenAI
load_dotenv("/data/hermes/.hermes/.env")
client = OpenAI(base_url="https://api.river.ai/v1", api_key=os.environ["RIVER_API_KEY"])
r = client.chat.completions.create(model="deepseek-ai/DeepSeek-V4.1-Flash", messages=[{"role":"user","content":"Hello"}])
print("River AI response:", r.choices[0].message.content)
'
```
