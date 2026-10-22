# End-to-End Deployment Guide (`docs/DEPLOYMENT_GUIDE.md`)

This guide walks through deploying the **Hermes Agent Web Workspace** from scratch on **any Spot VM or General Linux VM** (Google Cloud, Azure, AWS, Hetzner, or bare-metal) with a **persistent disk at `/data`**, **Cloudflare Workers + D1 + R2**, and **Google Cloud Vertex AI**.

---

## 1. Architecture Checklist Before Starting

You will need:
1. **A Google Cloud Project** with billing enabled (for Vertex AI Gemini models).
2. **A Cloudflare Account** (Free tier works out of the box for Workers, D1, R2, and Quick Tunnels).
3. **A Linux VM (Spot or Standard)** with a persistent disk mounted at `/data`.

---

## 2. Step-by-Step Setup

### Step 1: Prepare Google Cloud Vertex AI Credentials

Run these commands locally or on your VM where `gcloud` is authenticated:

```bash
export GCP_PROJECT_ID="your-gcp-project-id"

# 1. Enable the Vertex AI API
gcloud services enable aiplatform.googleapis.com --project="$GCP_PROJECT_ID"

# 2. Create a dedicated Service Account for the Cloudflare Worker
gcloud iam service-accounts create hermes-vertex-sa \
  --display-name="Hermes Agent Vertex AI Service Account" \
  --project="$GCP_PROJECT_ID"

# 3. Grant Vertex AI User role
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:hermes-vertex-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# 4. Generate a temporary JSON key file to upload to Cloudflare Worker Secrets
gcloud iam service-accounts keys create /tmp/gcp-sa-key.json \
  --iam-account="hermes-vertex-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
```

---

### Step 2: Mount the Persistent Disk (`/data`) on Your Spot VM / General VM

Ensure your persistent disk is formatted and mounted at `/data` so it survives VM preemptions and reboots:

```bash
# Check block devices
lsblk -f

# Create /data mount point
sudo mkdir -p /data

# Add to /etc/fstab using UUID (replace <UUID> with your disk's UUID from blkid)
# UUID=<UUID> /data ext4 defaults,nofail,x-systemd.device-timeout=10 0 2
sudo mount -a

# Create Hermes directories on /data
sudo mkdir -p /data/hermes/storage/sessions /data/hermes/logs /data/bin
```

Install `cloudflared` onto `/data/bin/cloudflared`:

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /data/bin/cloudflared
chmod +x /data/bin/cloudflared
sudo ln -sfn /data/bin/cloudflared /usr/local/bin/cloudflared
```

---

### Step 3: Install Hermes Agent CLI & Clone Repository onto `/data/hermes`

```bash
# 1. Symlink /root/.hermes to /data/hermes/.hermes BEFORE installing Hermes Agent
mkdir -p /data/hermes/.hermes
ln -sfn /data/hermes/.hermes /root/.hermes

# 2. Install NousResearch Hermes Agent CLI
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# 3. Clone this repository into /data/hermes/repo
git clone https://github.com/ajithvnr2001/hermes-agent-vertex-cloudflare.git /data/hermes/repo

# 4. Copy Spot VM Bridge, Sync Daemon, and Bootstrap scripts to /data/hermes
cp /data/hermes/repo/spot-vm-bridge/vm_bridge.py /data/hermes/vm_bridge.py
cp /data/hermes/repo/spot-vm-bridge/sync_to_data.py /data/hermes/sync_to_data.py
cp /data/hermes/repo/spot-vm-bridge/boot.sh /data/hermes/boot.sh
cp /data/hermes/repo/spot-vm-bridge/systemd/*.service /data/hermes/
chmod +x /data/hermes/vm_bridge.py /data/hermes/sync_to_data.py /data/hermes/boot.sh
```

---

### Step 4: Deploy Cloudflare Worker, D1 Database & R2 Bucket

```bash
cp -r /data/hermes/repo/cloudflare-worker /data/hermes/hermes-cloudflare-web
cd /data/hermes/hermes-cloudflare-web

# 1. Authenticate Wrangler (if not already logged in)
npx wrangler login

# 2. Create D1 Database and R2 Bucket
npx wrangler d1 create hermes-memory-db
npx wrangler r2 bucket create hermes-persistent-storage
```

Edit `/data/hermes/hermes-cloudflare-web/wrangler.toml`:
- Replace `YOUR_D1_DATABASE_ID` with the `database_id` output from `npx wrangler d1 create hermes-memory-db`.
- Replace `your-gcp-project-id` with your GCP Project ID.
- Replace `admin@example.com` with your desired login username/email.
- Replace `hermes.example.com` with your Cloudflare domain (or remove the `routes` block to deploy to `https://hermes-agent-web.<your-subdomain>.workers.dev`).

Initialize the D1 schema, upload secrets, and deploy:

```bash
# 3. Apply D1 SQL schema
npx wrangler d1 execute hermes-memory-db --remote --file=schema.sql

# 4. Upload GCP Service Account JSON key (and delete local copy immediately)
npx wrangler secret put GCP_SA_KEY < /tmp/gcp-sa-key.json
rm -f /tmp/gcp-sa-key.json

# 5. Set Web UI password and Spot VM Bridge shared secret
npx wrangler secret put AUTH_PASSWORD
npx wrangler secret put BRIDGE_SECRET

# 6. Deploy the Worker
npx wrangler deploy
```

---

### Step 5: Configure & Start Spot VM Systemd Services

Update the environment variables in `/data/hermes/hermes-bridge.service` and `/data/hermes/hermes-sync.service` (or pass them via `Environment=` lines in those service files):

```ini
Environment="HERMES_WORKER_URL=https://hermes.example.com"
Environment="HERMES_AUTH_USER=admin@example.com"
Environment="HERMES_AUTH_PASSWORD=YOUR_STRONG_PASSWORD"
Environment="HERMES_BRIDGE_SECRET=YOUR_BRIDGE_SECRET"
Environment="HERMES_DATA_DIR=/data/hermes"
```

Run `/data/hermes/boot.sh` to install the systemd services and register the `@reboot` cron job:

```bash
sudo /data/hermes/boot.sh

# Ensure boot.sh also runs automatically if the OS disk is ever re-imaged
(crontab -l 2>/dev/null | grep -v '/data/hermes/boot.sh'; echo '@reboot /data/hermes/boot.sh >> /data/hermes/logs/boot.log 2>&1') | crontab -
```

Verify that the tunnel registered with Cloudflare Worker:

```bash
systemctl status hermes-bridge.service hermes-sync.service hermes-dashboard.service
cat /data/hermes/logs/bridge.log | tail -n 20
```

You should see:
```text
[vm_bridge] Cloudflared tunnel active: https://<random-words>.trycloudflare.com
[vm_bridge] Registered tunnel URL with Cloudflare Worker: HTTP 200
```

Open your deployed URL in any desktop or mobile browser, sign in with `AUTH_USERNAME` and `AUTH_PASSWORD`, and verify the green `● /data Online` badge in the top bar!
