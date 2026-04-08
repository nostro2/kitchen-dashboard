#!/bin/bash
# Kitchen Dashboard — update script
# Called by cron every 30 minutes. Pulls latest code and applies config.

set -e

INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="dashboard"
PORT=8080

# Pull latest
git -C "$INSTALL_DIR" pull --ff-only

# Rewrite autostart (picks up any changes from the repo)
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/dashboard.desktop" << EOF
[Desktop Entry]
Type=Application
Name=Kitchen Dashboard
Exec=bash -c 'sleep 15 && unclutter -idle 0.1 -root & DISPLAY=:0 xdotool mousemove 0 99999 & firefox --kiosk --private-window http://localhost:${PORT}'
EOF

# Restart service
sudo /usr/bin/systemctl restart "$SERVICE_NAME"
