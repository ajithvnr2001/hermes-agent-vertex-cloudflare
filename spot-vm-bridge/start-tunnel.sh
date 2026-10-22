#!/usr/bin/env bash
set -euo pipefail

# Keep hermes.rpcserve.website routed directly to the local native Hermes Agent
# Web Dashboard (http://127.0.0.1:9119).
ROOT=/data/hermes
PROXY="$ROOT/hermes-cloudflare-web"
LOG="$ROOT/tunnel.log"
CLOUDFLARED=/data/bin/cloudflared
export HOME=/root
export XDG_CONFIG_HOME=/root/.config
export NODE_OPTIONS=--no-warnings

rm -f "$LOG"
"$CLOUDFLARED" tunnel --no-autoupdate --http-host-header 127.0.0.1:9119 --url http://127.0.0.1:9119 >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT

URL=""
for _ in $(seq 1 60); do
  sleep 2
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
done
if [ -z "$URL" ]; then
  echo "Tunnel did not provide a URL." >&2
  exit 1
fi
echo "$URL" >"$ROOT/tunnel-url"
echo "Hermes Dashboard Tunnel URL: $URL"

CURRENT=$(sed -n 's/^ORIGIN = "\(.*\)"/\1/p' "$PROXY/wrangler.toml" | head -1)
if [ "$CURRENT" != "$URL" ]; then
  sed -i "s|^ORIGIN = .*|ORIGIN = \"$URL\"|" "$PROXY/wrangler.toml"
  (
    cd "$PROXY"
    for attempt in 1 2 3; do
      if npx --yes wrangler deploy; then
        break
      fi
      echo "Deploy attempt $attempt failed." >&2
      sleep 5
    done
  ) || echo "Deploy failed; keeping previous origin." >&2
fi

wait "$TUNNEL_PID"
