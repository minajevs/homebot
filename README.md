# Telegram Home Bot

A small Telegram bot intended for a local Proxmox LXC. It uses **long polling**, so it needs no public IP address, inbound port forwarding, reverse proxy, or TLS certificate.

## Security model

- Telegram token is read from an environment file and never committed.
- The bot accepts private chats only by default.
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

## 3. Build it

```bash
npm run check
npm run build
node --env-file=.env dist/index.js
```

## 4. Deploy into a Proxmox LXC

Create an **unprivileged Debian 12/13 or Ubuntu LXC** with outbound DNS and HTTPS access. Do not forward any router ports.

Install Node.js 24 LTS using your preferred verified Node.js installation method, then copy this project to `/opt/homebot/app`:

```bash
sudo useradd --system --home /opt/homebot --shell /usr/sbin/nologin homebot
sudo mkdir -p /opt/homebot/app /etc/homebot
sudo chown -R homebot:homebot /opt/homebot

# From the project directory, copy the built app and package files.
sudo rsync -a --delete --exclude .env ./ /opt/homebot/app/
cd /opt/homebot/app
sudo -u homebot npm ci --omit=dev
```

Build before deployment, or install dev dependencies temporarily and run `npm run build` in the LXC. The service starts `dist/index.js`, so `dist/` must exist.

Create `/etc/homebot/homebot.env`:

```ini
TELEGRAM_BOT_TOKEN=replace-with-real-token
ALLOWED_USER_IDS=123456789
PRIVATE_CHAT_ONLY=true
BOT_NAME=HomeBot
```

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

```bash
cd /opt/homebot/app
sudo -u homebot npm ci --omit=dev
sudo systemctl restart homebot
sudo journalctl -u homebot -n 100 --no-pager
```
