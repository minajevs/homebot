# Telegram Home Bot

A small Telegram bot intended for a local Proxmox LXC. It uses **long polling**, so it needs no public IP address, inbound port forwarding, reverse proxy, or TLS certificate.

Its first job is a **weekly rain tally**: household members post rain gauge readings (a plain number of millimetres) into a shared group chat, and the bot keeps a running total that resets every Monday, so weekend lawn watering can be planned around actual rainfall.

## Security model

- Telegram token is read from an environment file and never committed.
- The bot accepts private chats, plus only the group chats listed in `ALLOWED_CHAT_IDS`.
- All command handling is restricted to `ALLOWED_USER_IDS`.
- An empty `ALLOWED_USER_IDS` enables a limited one-time bootstrap mode where only `/whoami` replies.
- The bot does not execute arbitrary shell commands.

## 1. Create the Telegram bot

1. In Telegram, open `@BotFather`.
2. Send `/newbot` and complete the prompts.
3. Copy its token.

## 2. Run locally during development

Requires Node.js 22+.

```bash
cp .env.example .env
# Edit .env and set TELEGRAM_BOT_TOKEN.
npm install
npm run dev
```

In a private chat with the bot, send:

```text
/whoami
```

Copy the returned number into `ALLOWED_USER_IDS`, stop the dev process, and run `npm run dev` again. From then on, only that account can use the bot.

## 3. Set up the rain tally group

1. In `@BotFather`, send `/setprivacy`, pick the bot, and choose **Disable**. Without this, bots in groups only receive commands and never see a plain message like `7`.
2. Add the bot to the group chat.
3. Send `/chatid` in the group and copy the returned (negative) number into `ALLOWED_CHAT_IDS`.
4. Every household member sends `/whoami` in the group; add their IDs to `ALLOWED_USER_IDS`.
5. Restart the bot.

From then on:

- A message that is just a number (`7`, `7.5`, or `7,5`) records that many millimetres of rain. The bot acknowledges with a 👍 reaction and ignores all other chatter.
- `/rain` shows the running total since Monday, with the individual readings.
- `/undo` removes the most recent reading of the current week (for typos).
- Every Saturday at 09:00 (configurable via `RAIN_REMINDER`, or `off`) the bot posts the week's total to the group.

The weekly window is computed from stored timestamps, so nothing is lost if the bot is down over midnight on Monday. Readings are stored in the JSON file at `RAIN_DATA_FILE`. Set `TZ` so "Monday" and the reminder time follow your local clock.

## 4. Build it

```bash
npm run check
npm run build
node --env-file=.env dist/index.js
```

## 5. Deploy into a Proxmox LXC

Create an **unprivileged Debian 12/13 or Ubuntu LXC** with outbound DNS and HTTPS access. Do not forward any router ports.

Install Node.js 24 LTS using your preferred verified Node.js installation method, then copy this project to `/opt/homebot/app`:

```bash
sudo useradd --system --home /opt/homebot --shell /usr/sbin/nologin homebot
sudo mkdir -p /opt/homebot/app /opt/homebot/data /etc/homebot
sudo chown -R homebot:homebot /opt/homebot

# From the project directory, copy the built app and package files.
sudo rsync -a --delete --exclude .env --exclude data ./ /opt/homebot/app/
cd /opt/homebot/app
sudo -u homebot npm ci --omit=dev
```

Build before deployment, or install dev dependencies temporarily and run `npm run build` in the LXC. The service starts `dist/index.js`, so `dist/` must exist.

Create `/etc/homebot/homebot.env`:

```ini
TELEGRAM_BOT_TOKEN=replace-with-real-token
ALLOWED_USER_IDS=123456789
ALLOWED_CHAT_IDS=-1001234567890
RAIN_DATA_FILE=/opt/homebot/data/rain.json
RAIN_REMINDER=saturday 09:00
TZ=Europe/Riga
BOT_NAME=HomeBot
```

`RAIN_DATA_FILE` deliberately points outside `/opt/homebot/app`, so redeploys and `git pull` never touch the accumulated readings.

Lock down its permissions:

```bash
sudo chmod 600 /etc/homebot/homebot.env
sudo chown root:root /etc/homebot/homebot.env
```

Install and start the systemd service:

```bash
sudo cp deploy/homebot.service /etc/systemd/system/homebot.service
sudo systemctl daemon-reload
sudo systemctl enable --now homebot
sudo journalctl -u homebot -f
```

## Adding real home commands safely

Keep each action narrow and explicit. Good:

```ts
bot.command("lights_off", async (ctx) => {
  // Call a single Home Assistant script or internal endpoint here.
  await ctx.reply("Lights-off request sent.");
});
```

Avoid designs like `/exec <command>`, passing raw user text into shells, or giving the bot unrestricted access to Proxmox, Home Assistant, or the whole LAN.

## Updating

After pushing new code, run the update script inside the LXC as root. It pulls,
rebuilds, drops dev dependencies, and restarts the service:

```bash
sudo bash /opt/homebot/app/deploy/update.sh
```
