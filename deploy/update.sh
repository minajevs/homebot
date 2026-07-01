#!/usr/bin/env bash
#
# Pull the latest code and restart the bot. Run INSIDE THE CONTAINER as root.
#
set -euo pipefail

APP_USER="${APP_USER:-homebot}"
APP_DIR="/opt/homebot/app"

cd "${APP_DIR}"
sudo -u "${APP_USER}" git pull --ff-only
sudo -u "${APP_USER}" npm ci
sudo -u "${APP_USER}" npm run build
sudo -u "${APP_USER}" npm prune --omit=dev
systemctl restart homebot
journalctl -u homebot -n 30 --no-pager
