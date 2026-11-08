import type { FastifyRequest } from "fastify";
import { env, isDevToolsEnabled } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../shared/errors.js";
import { validateTelegramWebAppData } from "../shared/telegram-auth.js";

type AuthIdentity = {
  telegramUserId: bigint;
  isDevBypass: boolean;
};

export const parsePositiveBigInt = (value: unknown): bigint | null => {
  if (typeof value !== "string") return null;
  if (!/^[1-9]\d*$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

export const extractTelegramIdentity = (request: FastifyRequest): AuthIdentity => {
  const isDevBypass = isDevToolsEnabled && request.headers["x-bypass-auth"] === "true";

  if (isDevBypass) {
    const rawDevId = request.headers["x-dev-user-id"];
    const devId = parsePositiveBigInt(Array.isArray(rawDevId) ? rawDevId[0] : rawDevId);
    if (!devId) {
      throw new AppError(400, "x-dev-user-id header required in dev bypass mode");
    }
    request.log.warn({ devId: devId.toString() }, "BYPASSING AUTHENTICATION (DEV MODE)");
    return {
      telegramUserId: devId,
      isDevBypass: true
    };
  }

  const rawInitData = request.headers["x-telegram-init-data"];
  const initData = Array.isArray(rawInitData) ? rawInitData[0] : rawInitData;
  if (!initData) {
    throw new AppError(401, "Missing authentication header (X-Telegram-Init-Data)");
  }

  const validated = validateTelegramWebAppData(
    initData,
    env.TELEGRAM_BOT_TOKEN || "",
    env.TELEGRAM_AUTH_MAX_AGE_SECONDS
  );
  if (!validated) {
    throw new AppError(401, "Invalid authentication signature");
  }

  return {
    telegramUserId: BigInt(validated.user.id),
    isDevBypass: false
  };
};

export const getAuthenticatedUser = async (request: FastifyRequest) => {
  const identity = extractTelegramIdentity(request);
  const user = await prisma.user.findUnique({
    where: {
      telegramId: identity.telegramUserId
    }
  });

  if (!user) {
    throw new AppError(404, "User not found. Sync user first.");
  }

  return { identity, user };
};

export type SocketAuthPayload = {
  initData?: string;
  devBypass?: boolean;
  devUserId?: string;
};

export const extractSocketTelegramId = (payload: SocketAuthPayload | undefined): bigint | null => {
  if (!payload) return null;

  const isDevBypass = isDevToolsEnabled && payload.devBypass === true;
  if (isDevBypass) {
    return parsePositiveBigInt(payload.devUserId) ?? null;
  }

  if (!payload.initData) return null;
  const validated = validateTelegramWebAppData(
    payload.initData,
    env.TELEGRAM_BOT_TOKEN || "",
    env.TELEGRAM_AUTH_MAX_AGE_SECONDS
  );
  if (!validated) return null;
  return BigInt(validated.user.id);
};
