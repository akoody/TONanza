import crypto from "node:crypto";
import { AppError } from "./errors.js";

export type TelegramUserPayload = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
};

export type TelegramAuthContext = {
  telegramId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
};

const parseInitData = (initData: string): URLSearchParams => {
  try {
    return new URLSearchParams(initData);
  } catch {
    throw new AppError(401, "Некорректные данные Telegram", "INVALID_TELEGRAM_INIT_DATA");
  }
};

const validateSignature = (initData: string, botToken: string): URLSearchParams => {
  const params = parseInitData(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new AppError(401, "Нет подписи Telegram", "MISSING_TELEGRAM_HASH");
  }

  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  });
  pairs.sort();

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculated = crypto.createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");

  const left = Buffer.from(calculated, "hex");
  const right = Buffer.from(hash, "hex");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new AppError(401, "Неверная подпись Telegram", "INVALID_TELEGRAM_SIGNATURE");
  }

  return params;
};

const asStringOrNull = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

export const resolveTelegramAuth = (headers: Record<string, unknown>, botToken?: string): TelegramAuthContext => {
  const bypass = headers["x-bypass-auth"] === "true";
  if (bypass && process.env.NODE_ENV !== "production") {
    const rawId = String(headers["x-dev-user-id"] ?? "100000001");
    if (!/^[1-9]\d*$/.test(rawId)) {
      throw new AppError(401, "Некорректный dev Telegram ID", "INVALID_DEV_USER");
    }
    return {
      telegramId: BigInt(rawId),
      username: "dev_user",
      firstName: "Dev",
      lastName: null,
      avatarUrl: null
    };
  }

  const initData = headers["x-telegram-init-data"];
  if (typeof initData !== "string" || initData.length === 0) {
    throw new AppError(401, "Откройте приложение через Telegram", "TELEGRAM_AUTH_REQUIRED");
  }
  if (!botToken) {
    throw new AppError(500, "TELEGRAM_BOT_TOKEN не настроен", "BOT_TOKEN_REQUIRED");
  }

  const params = validateSignature(initData, botToken);
  const rawUser = params.get("user");
  if (!rawUser) {
    throw new AppError(401, "Нет пользователя Telegram", "TELEGRAM_USER_REQUIRED");
  }

  const user = JSON.parse(rawUser) as TelegramUserPayload;
  if (!Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new AppError(401, "Некорректный пользователь Telegram", "INVALID_TELEGRAM_USER");
  }

  return {
    telegramId: BigInt(user.id),
    username: asStringOrNull(user.username, 64),
    firstName: asStringOrNull(user.first_name, 128),
    lastName: asStringOrNull(user.last_name, 128),
    avatarUrl: asStringOrNull(user.photo_url, 512)
  };
};
