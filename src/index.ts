import { Bot, BotError, Context, GrammyError, HttpError } from "grammy";
import { bootstrapMode, config } from "./config.js";
import { formatMm, parseRainMm, RainLog, startOfWeek } from "./rain.js";

const bot = new Bot(config.token);
const rainLog = await RainLog.open(config.rainDataFile);

type AuthorizedContext = Context;

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

function isAllowed(ctx: Context): boolean {
  const userId = ctx.from?.id;
  return userId !== undefined && config.allowedUserIds.has(userId);
}

function isAllowedGroup(ctx: Context): boolean {
  const chatId = ctx.chat?.id;
  return chatId !== undefined && config.allowedChatIds.has(chatId);
}

function isCommand(text: string | undefined, command: string): boolean {
  return text !== undefined && new RegExp(`^/${command}(@\\w+)?(\\s|$)`).test(text);
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

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function weekSummary(): string {
  const readings = rainLog.readingsThisWeek();
  const since = formatDay(startOfWeek());

  if (readings.length === 0) {
    return `No rain recorded this week (since ${since}).`;
  }

  const lines = readings.map(
    (reading) => `• ${formatDay(new Date(reading.at))} — ${formatMm(reading.mm)} mm`
  );
  return [`🌧 Rain since ${since}: ${formatMm(rainLog.totalThisWeek())} mm`, ...lines].join("\n");
}

bot.use(async (ctx, next) => {
  // First-run escape hatch: it reveals only the sender's numeric Telegram ID.
  // Configure ALLOWED_USER_IDS and restart the service immediately afterwards.
  if (bootstrapMode) {
    if (isCommand(ctx.message?.text, "whoami") && isPrivateChat(ctx)) {
      await ctx.reply(
        `Your Telegram user ID is: ${ctx.from?.id}\n\n` +
        "Set ALLOWED_USER_IDS to this value in the service environment file, then restart the bot."
      );
    }
    return;
  }

  if (!isPrivateChat(ctx) && !isAllowedGroup(ctx)) {
    // Let an allowed user run /chatid in a not-yet-allowlisted group to discover its ID.
    if (isAllowed(ctx) && isCommand(ctx.message?.text, "chatid")) {
      return next();
    }
    return;
  }

  if (!isAllowed(ctx)) {
    // Anyone already inside an allowed group may look up their own ID,
    // so a new household member can be added to ALLOWED_USER_IDS.
    if (isAllowedGroup(ctx) && isCommand(ctx.message?.text, "whoami")) {
      return next();
    }
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
    "Post a plain number in the group (e.g. \"7\" or \"7,5\") to record rain in mm.",
    "",
    "/rain — show this week's rain total",
    "/undo — remove the most recent reading this week",
    "/chatid — show this chat's ID",
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

bot.command("chatid", async (ctx: AuthorizedContext) => {
  commandLog(ctx, "chatid");
  await ctx.reply(
    `This chat's ID is: ${ctx.chat?.id}\n\n` +
    "Add it to ALLOWED_CHAT_IDS in the service environment file, then restart the bot."
  );
});

bot.command("rain", async (ctx: AuthorizedContext) => {
  commandLog(ctx, "rain");
  await ctx.reply(weekSummary());
});

bot.command("undo", async (ctx: AuthorizedContext) => {
  commandLog(ctx, "undo");
  const removed = await rainLog.undoLastThisWeek();
  if (!removed) {
    await ctx.reply("Nothing to undo this week.");
    return;
  }
  await ctx.reply(
    `Removed ${formatMm(removed.mm)} mm (${formatDay(new Date(removed.at))}). ` +
    `Week total is now ${formatMm(rainLog.totalThisWeek())} mm.`
  );
});

bot.on("message:text", async (ctx) => {
  const mm = parseRainMm(ctx.message.text);

  if (mm !== undefined) {
    await rainLog.add({
      mm,
      at: new Date().toISOString(),
      userId: ctx.from?.id ?? 0,
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id
    });
    console.info(JSON.stringify({
      event: "rain_recorded",
      mm,
      weekTotal: rainLog.totalThisWeek(),
      userId: ctx.from?.id,
      at: new Date().toISOString()
    }));
    try {
      await ctx.react("👍");
    } catch {
      await ctx.reply(`Recorded ${formatMm(mm)} mm. Week total: ${formatMm(rainLog.totalThisWeek())} mm.`);
    }
    return;
  }

  // Stay quiet in the group so normal conversation is not disturbed.
  if (isPrivateChat(ctx)) {
    await ctx.reply("I only understand commands and rain readings (a plain number in mm). Try /help.");
  }
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

function nextReminderTime(from: Date): Date {
  const spec = config.rainReminder;
  if (!spec) throw new Error("nextReminderTime called without a reminder configured");

  const next = new Date(from);
  next.setHours(spec.hour, spec.minute, 0, 0);
  let daysAhead = (spec.dayOfWeek - next.getDay() + 7) % 7;
  if (daysAhead === 0 && next <= from) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);
  return next;
}

function scheduleReminder(chatId: number): void {
  const at = nextReminderTime(new Date());
  console.info(`Next rain reminder: ${at.toString()}`);

  setTimeout(async () => {
    try {
      await bot.api.sendMessage(chatId, `${weekSummary()}\n\nTime to plan the lawn watering. 💧`);
    } catch (error) {
      console.error("Failed to send rain reminder", error);
    }
    scheduleReminder(chatId);
  }, at.getTime() - Date.now());
}

async function main(): Promise<void> {
  if (bootstrapMode) {
    console.warn("BOOTSTRAP MODE: ALLOWED_USER_IDS is empty. Only /whoami in a private chat will respond.");
  }

  // getUpdates cannot work while a webhook is set. This makes a transition from
  // a previous webhook deployment explicit without discarding queued messages.
  await bot.api.deleteWebhook({ drop_pending_updates: false });

  await bot.api.setMyCommands([
    { command: "rain", description: "Show this week's rain total" },
    { command: "undo", description: "Remove the most recent rain reading" },
    { command: "chatid", description: "Show this chat's ID" },
    { command: "status", description: "Check bot status" },
    { command: "whoami", description: "Show your Telegram user ID" },
    { command: "help", description: "Show available commands" }
  ]);

  const reminderChatId = [...config.allowedChatIds][0];
  if (config.rainReminder && reminderChatId !== undefined) {
    scheduleReminder(reminderChatId);
  } else if (config.rainReminder) {
    console.warn("RAIN_REMINDER is set but ALLOWED_CHAT_IDS is empty; no reminder will be sent.");
  }

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
