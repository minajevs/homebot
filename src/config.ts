function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseIdList(name: string, value: string | undefined, allowNegative: boolean): ReadonlySet<number> {
  if (!value?.trim()) return new Set<number>();

  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));

  const valid = allowNegative
    ? (id: number) => Number.isSafeInteger(id) && id !== 0
    : (id: number) => Number.isSafeInteger(id) && id > 0;

  if (ids.some((id) => !valid(id))) {
    throw new Error(`${name} must contain only numeric Telegram IDs.`);
  }

  return new Set(ids);
}

export interface ReminderSpec {
  dayOfWeek: number; // 0 = Sunday, matching Date.getDay()
  hour: number;
  minute: number;
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// "<day> <HH:MM>" in the process-local timezone, e.g. "saturday 09:00". "off" disables it.
function parseReminder(value: string | undefined): ReminderSpec | undefined {
  const spec = value?.trim().toLowerCase() || "saturday 09:00";
  if (["off", "none", "disabled"].includes(spec)) return undefined;

  const match = /^([a-z]+)\s+(\d{1,2}):(\d{2})$/.exec(spec);
  const dayOfWeek = match ? DAY_NAMES.indexOf(match[1] ?? "") : -1;
  const hour = match ? Number(match[2]) : NaN;
  const minute = match ? Number(match[3]) : NaN;

  if (dayOfWeek === -1 || hour > 23 || minute > 59 || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`RAIN_REMINDER must look like "saturday 09:00" or be "off", got: ${value}`);
  }

  return { dayOfWeek, hour, minute };
}

export const config = {
  token: required("TELEGRAM_BOT_TOKEN"),
  allowedUserIds: parseIdList("ALLOWED_USER_IDS", process.env.ALLOWED_USER_IDS, false),
  // Group chats the bot participates in (group IDs are negative). Empty = private chats only.
  allowedChatIds: parseIdList("ALLOWED_CHAT_IDS", process.env.ALLOWED_CHAT_IDS, true),
  rainDataFile: process.env.RAIN_DATA_FILE?.trim() || "data/rain.json",
  rainReminder: parseReminder(process.env.RAIN_REMINDER),
  botName: process.env.BOT_NAME?.trim() || "HomeBot"
} as const;

export const bootstrapMode = config.allowedUserIds.size === 0;
