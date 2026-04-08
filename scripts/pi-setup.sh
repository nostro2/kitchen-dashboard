#!/bin/bash
# Kitchen Dashboard — Raspberry Pi setup script
# Run once after first boot: bash pi-setup.sh

set -e

REPO_URL="https://github.com/nostro2/kitchen-dashboard.git"
INSTALL_DIR="$HOME/kitchen-dashboard"
SERVICE_NAME="dashboard"
PORT=8080

echo "=== Kitchen Dashboard Pi Setup ==="
echo

# ── 1. Install git if missing ────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  echo "[1/6] Installing git..."
  sudo apt-get update -q && sudo apt-get install -y -q git
else
  echo "[1/6] git already installed."
fi

# ── 2. Clone repo ────────────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[2/6] Repo already cloned, pulling latest..."
  git -C "$INSTALL_DIR" pull
else
  echo "[2/6] Cloning repo to $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ── 3. Write .env ────────────────────────────────────────────────────────────
echo "[3/6] Setting up credentials..."
if [ -f "$INSTALL_DIR/.env" ]; then
  echo "      .env already exists, skipping."
else
  read -rp "      Enter RTT_TOKEN: " rtt_token
  echo "RTT_TOKEN=${rtt_token}" > "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
  echo "      .env written."
fi

# ── 4. Create systemd service ────────────────────────────────────────────────
echo "[4/6] Installing systemd service..."
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Kitchen Dashboard
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=${INSTALL_DIR}
ExecStartPre=/usr/bin/git -C ${INSTALL_DIR} pull
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/server.py ${PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
echo "      Service enabled and started."

# ── 5. Allow user to restart service without password ────────────────────────
echo "[5/6] Configuring sudoers for service restart..."
SUDOERS_FILE="/etc/sudoers.d/dashboard"
sudo tee "$SUDOERS_FILE" > /dev/null << EOF
$USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart ${SERVICE_NAME}
EOF
sudo chmod 440 "$SUDOERS_FILE"

# ── 6. Cron: run update script every 30 minutes ──────────────────────────────
echo "[6/6] Setting up cron job (update every 30 minutes)..."
chmod +x "$INSTALL_DIR/scripts/update.sh"
CRON_JOB="*/30 * * * * $INSTALL_DIR/scripts/update.sh >> /tmp/dashboard-update.log 2>&1"
# Add only if not already present
( crontab -l 2>/dev/null | grep -v "dashboard.*update\|systemctl restart ${SERVICE_NAME}"; echo "$CRON_JOB" ) | crontab -
echo "      Cron job set."

# ── 7. Install unclutter + xdotool (hide/move mouse cursor) ──────────────────
echo "[7/8] Installing unclutter and xdotool..."
sudo apt-get install -y -q unclutter xdotool

# ── 8. Autostart Firefox in kiosk mode ───────────────────────────────────────
echo "[8/8] Setting up Firefox kiosk autostart..."
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/dashboard.desktop" << EOF
[Desktop Entry]
Type=Application
Name=Kitchen Dashboard
Exec=bash -c 'sleep 15 && unclutter -idle 0.1 -root & xdotool mousemove 0 99999 & firefox --kiosk http://localhost:${PORT}'
EOF
echo "      Autostart written."

# ── Done ─────────────────────────────────────────────────────────────────────
echo
echo "=== Setup complete ==="
echo
echo "  Dashboard URL : http://localhost:${PORT}"
echo "  Service status: sudo systemctl status ${SERVICE_NAME}"
echo "  Service logs  : journalctl -u ${SERVICE_NAME} -f"
echo
echo "Reboot to test the full kiosk startup:"
echo "  sudo reboot"
