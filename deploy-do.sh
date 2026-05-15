#!/bin/bash
# Deploy hyper-video-service to a DigitalOcean Droplet
# Usage: ./deploy-do.sh [DROPLET_IP]
#
# Prerequisites:
# - DIGITALOCEAN_TOKEN env var set
# - SSH key registered in DO (optional, will use password auth otherwise)
#
# This script:
# 1. Creates a 4GB Droplet if IP not provided
# 2. Installs Node 22, Chrome, FFmpeg
# 3. Clones and starts the service

set -e

SSH_KEY_ID=${SSH_KEY_ID:-}  # DO SSH key fingerprint
REGION=${DO_REGION:-nyc1}
DROPLET_NAME=${DROPLET_NAME:-hyper-video-service}
SIZE=${DO_SIZE:-s-2vcpu-4gb}

if [ -z "$DIGITALOCEAN_TOKEN" ]; then
  echo "Error: DIGITALOCEAN_TOKEN not set"
  echo "Export it: export DIGITALOCEAN_TOKEN=your_token_here"
  exit 1
fi

if [ -n "$1" ]; then
  DROPLET_IP="$1"
  echo "Using existing droplet: $DROPLET_IP"
else
  echo "Creating Droplet: $DROPLET_NAME ($SIZE in $REGION)..."

  # Create SSH key param if provided
  SSH_PARAM=""
  if [ -n "$SSH_KEY_ID" ]; then
    SSH_PARAM=",\"ssh_keys\":[$SSH_KEY_ID]"
  fi

  RESPONSE=$(curl -s -X POST "https://api.digitalocean.com/v2/droplets" \
    -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"$DROPLET_NAME\",
      \"region\": \"$REGION\",
      \"size\": \"$SIZE\",
      \"image\": \"ubuntu-24-04-x64\",
      \"user_data\": \"#cloud-config\npackages:\n  - curl\n  - git\"
      $SSH_PARAM
    }")

  DROPLET_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['droplet']['id'])")
  echo "Droplet ID: $DROPLET_ID"

  echo "Waiting for droplet to become active..."
  while true; do
    STATUS=$(curl -s "https://api.digitalocean.com/v2/droplets/$DROPLET_ID" \
      -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" | \
      python3 -c "import sys,json; print(json.load(sys.stdin)['droplet']['status'])")
    if [ "$STATUS" = "active" ]; then break; fi
    echo "  Status: $STATUS... waiting"
    sleep 10
  done

  DROPLET_IP=$(curl -s "https://api.digitalocean.com/v2/droplets/$DROPLET_ID" \
    -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" | \
    python3 -c "import sys,json; d=json.load(sys.stdin)['droplet']; print(d['networks']['v4'][0]['ip_address'])")
  echo "Droplet IP: $DROPLET_IP"
fi

echo ""
echo "Provisioning $DROPLET_IP..."
echo "This will take a few minutes..."

# Provision the droplet via SSH
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@$DROPLET_IP 'bash -s' <<'PROVISION'
set -e

echo "=== Updating system ==="
apt-get update && apt-get upgrade -y

echo "=== Installing Node.js 22 ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "=== Installing Chrome dependencies ==="
apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2t64 libxshmfence1 libatspi2.0-0 \
  libnspr4 fonts-noto-color-emoji fonts-inter \
  xvfb xauth

echo "=== Installing FFmpeg ==="
apt-get install -y ffmpeg

echo "=== Installing Google Chrome ==="
curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb
dpkg -i /tmp/chrome.deb || apt-get install -f -y
rm /tmp/chrome.deb

echo "=== Creating app user ==="
useradd -m -s /bin/bash app || true

echo "=== Cloning repo ==="
cd /home/app
git clone https://github.com/TWilson63/hyper-video-service.git
cd hyper-video-service
npm install --production

echo "=== Creating systemd service ==="
cat > /etc/systemd/system/hyper-video.service <<'SERVICE'
[Unit]
Description=Hyper Video Service (MCP)
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=/home/app/hyper-video-service
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HYPER_VIDEO_API_KEY=REPLACE_ME
Environment=CHROME_PATH=/usr/bin/google-chrome-stable

[Install]
WantedBy=multi-user.target
SERVICE

echo "=== Setting permissions ==="
chown -R app:app /home/app/hyper-video-service

echo "=== Starting service ==="
systemctl daemon-reload
systemctl enable hyper-video
systemctl start hyper-video

echo "=== Done! ==="
echo "Service running on http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "IMPORTANT: Set your API key!"
echo "  ssh root@$(hostname -I | awk '{print $1}')"
echo "  vi /etc/systemd/system/hyper-video.service"
echo "  # Replace REPLACE_ME with your API key"
echo "  systemctl daemon-reload"
echo "  systemctl restart hyper-video"
PROVISION

echo ""
echo "========================================="
echo "Droplet IP: $DROPLET_IP"
echo "Service URL: http://$DROPLET_IP:3000"
echo "MCP endpoint: http://$DROPLET_IP:3000/mcp"
echo "Health check: http://$DROPLET_IP:3000/health"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. SSH in and set HYPER_VIDEO_API_KEY in the systemd service"
echo "2. Point your domain (e.g., video.zenbin.org) to this IP"
echo "3. Set up HTTPS with certbot"