function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`Expected a boolean value, got: ${value}`);
  }
}

function parseUserIds(value: string | undefined): ReadonlySet<number> {
  if (!value?.trim()) return new Set<number>();

  const userIds = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));

  if (userIds.some((userId) => !Number.isSafeInteger(userId) || userId <= 0)) {
    throw new Error("ALLOWED_USER_IDS must contain only positive numeric Telegram user IDs.");
  }

  return new Set(userIds);
}

export const config = {
  token: required("TELEGRAM_BOT_TOKEN"),
  allowedUserIds: parseUserIds(process.env.ALLOWED_USER_IDS),
  privateChatOnly: parseBoolean(process.env.PRIVATE_CHAT_ONLY, true),
  botName: process.env.BOT_NAME?.trim() || "HomeBot"
} as const;

export const bootstrapMode = config.allowedUserIds.size === 0;
