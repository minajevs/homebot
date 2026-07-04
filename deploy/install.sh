#!/usr/bin/env bash
#
# Install the Telegram home bot inside the LXC.
# Run this INSIDE THE CONTAINER as root.
#
# Usage:
#   REPO_URL=https://github.com/you/telegram-home-bot.git bash install.sh
#
set -euo pipefail

REPO_URL="${REPO_URL:?Set REPO_URL to your git clone URL}"
NODE_MAJOR="${NODE_MAJOR:-24}"
APP_USER="${APP_USER:-homebot}"
APP_HOME="/opt/homebot"
APP_DIR="${APP_HOME}/app"
DATA_DIR="${APP_HOME}/data"
ENV_DIR="/etc/homebot"
ENV_FILE="${ENV_DIR}/homebot.env"

echo ">> Installing base packages"
apt-get update -y
apt-get install -y curl ca-certificates git

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt "${NODE_MAJOR}" ]]; then
  echo ">> Installing Node.js ${NODE_MAJOR}.x (NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
echo ">> Node: $(node -v),  npm: $(npm -v)"

echo ">> Creating service user ${APP_USER}"
id -u "${APP_USER}" >/dev/null 2>&1 || \
  useradd --system --home "${APP_HOME}" --shell /usr/sbin/nologin "${APP_USER}"
mkdir -p "${APP_DIR}" "${DATA_DIR}" "${ENV_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}"

echo ">> Fetching source into ${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  sudo -u "${APP_USER}" git -C "${APP_DIR}" pull --ff-only
else
  sudo -u "${APP_USER}" git clone "${REPO_URL}" "${APP_DIR}"
fi

echo ">> Building"
cd "${APP_DIR}"
sudo -u "${APP_USER}" npm ci
sudo -u "${APP_USER}" npm run build
sudo -u "${APP_USER}" npm prune --omit=dev   # drop dev deps after build

if [[ ! -f "${ENV_FILE}" ]]; then
  echo ">> Creating ${ENV_FILE} (fill in your token next)"
  cat > "${ENV_FILE}" <<'EOF'
TELEGRAM_BOT_TOKEN=replace-with-real-token
ALLOWED_USER_IDS=
ALLOWED_CHAT_IDS=
RAIN_DATA_FILE=/opt/homebot/data/rain.json
RAIN_REMINDER=saturday 09:00
TZ=Europe/Riga
BOT_NAME=HomeBot
EOF
fi
chown root:root "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

echo ">> Installing systemd service"
cp "${APP_DIR}/deploy/homebot.service" /etc/systemd/system/homebot.service
systemctl daemon-reload
systemctl enable homebot

echo
echo "Done. Next:"
echo "  1. Edit ${ENV_FILE} and set TELEGRAM_BOT_TOKEN."
echo "  2. systemctl start homebot"
echo "  3. Message /whoami to the bot, copy your ID into ALLOWED_USER_IDS,"
echo "     then: systemctl restart homebot"
echo "  4. For the rain tally: disable the bot's group privacy mode via @BotFather"
echo "     (/setprivacy -> Disable), add the bot to your group, run /chatid there,"
echo "     copy the ID into ALLOWED_CHAT_IDS, then: systemctl restart homebot"
echo "  Logs: journalctl -u homebot -f"
