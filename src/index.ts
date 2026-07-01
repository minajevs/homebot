import { Bot, BotError, Context, GrammyError, HttpError } from "grammy";
import { bootstrapMode, config } from "./config.js";

const bot = new Bot(config.token);

type AuthorizedContext = Context;

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

function isAllowed(ctx: Context): boolean {
  const userId = ctx.from?.id;
  return userId !== undefined && config.allowedUserIds.has(userId);
}

function commandLog(ctx: Context, command: string): void {
  console.info(JSON.stringify({
    event: "command",
    command,
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
    at: new Date().toISOString()
  }));
}

bot.use(async (ctx, next) => {
  if (config.privateChatOnly && !isPrivateChat(ctx)) {
    return;
  }

  // First-run escape hatch: it reveals only the sender's numeric Telegram ID.
  // Configure ALLOWED_USER_IDS and restart the service immediately afterwards.
  if (bootstrapMode) {
    if (ctx.message?.text?.startsWith("/whoami") && isPrivateChat(ctx)) {
      await ctx.reply(
        `Your Telegram user ID is: ${ctx.from?.id}\n\n` +
        "Set ALLOWED_USER_IDS to this value in the service environment file, then restart the bot."
      );
    }
    return;
  }

  if (!isAllowed(ctx)) {
    console.warn(JSON.stringify({
      event: "unauthorized_update",
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
      at: new Date().toISOString()
    }));
    return;
  }

  await next();
});

bot.command("start", async (ctx: AuthorizedContext) => {
  commandLog(ctx, "start");
  await ctx.reply(`${config.botName} is online. Use /help to see available commands.`);
});

bot.command("help", async (ctx: AuthorizedContext) => {
  commandLog(ctx, "help");
  await ctx.reply([
    "/status — confirm that the bot is running",
    "/whoami — show your Telegram user ID",
    "/help — show this help"
  ].join("\n"));
});

bot.command("status", async (ctx: AuthorizedContext) => {
  commandLog(ctx, "status");
  await ctx.reply(`${config.botName} is running on the local server.`);
});

bot.command("whoami", async (ctx: AuthorizedContext) => {
  commandLog(ctx, "whoami");
  await ctx.reply(`Your Telegram user ID is: ${ctx.from?.id}`);
});

bot.on("message:text", async (ctx: AuthorizedContext) => {
  commandLog(ctx, "message");
  await ctx.reply("I only understand commands for now. Try /help.");
});

bot.catch((err) => {
  const ctx = err.ctx;
  const error = err.error;

  console.error(JSON.stringify({
    event: "bot_error",
    updateId: ctx.update.update_id,
    error: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString()
  }));

  if (error instanceof GrammyError) {
    console.error("Telegram API error", error.description);
  } else if (error instanceof HttpError) {
    console.error("Network error while calling Telegram", error);
  } else if (error instanceof BotError) {
    console.error("Unhandled bot error", error);
  }
});

async function main(): Promise<void> {
  if (bootstrapMode) {
    console.warn("BOOTSTRAP MODE: ALLOWED_USER_IDS is empty. Only /whoami in a private chat will respond.");
  }

  // getUpdates cannot work while a webhook is set. This makes a transition from
  // a previous webhook deployment explicit without discarding queued messages.
  await bot.api.deleteWebhook({ drop_pending_updates: false });

  await bot.api.setMyCommands([
    { command: "start", description: "Start the bot" },
    { command: "status", description: "Check bot status" },
    { command: "whoami", description: "Show your Telegram user ID" },
    { command: "help", description: "Show available commands" }
  ]);

  console.info(`${config.botName} starting with long polling.`);

  bot.start({
    allowed_updates: ["message"],
    onStart: (botInfo) => {
      console.info(`${config.botName} is online as @${botInfo.username}.`);
    }
  });
}

void main();

function shutdown(signal: string): void {
  console.info(`Received ${signal}; stopping bot.`);
  bot.stop();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
