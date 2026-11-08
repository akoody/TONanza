import type { ChatDeleteAck, ChatHistoryAck, ChatMessage, ChatSendAck, ChatToggleAck } from "../types";
import { sanitizeAvatarUrl, sanitizeChatText, sanitizeDisplayName } from "./security";

export const CHAT_HISTORY_LIMIT = 100;
export const CHAT_MAX_MESSAGE_LENGTH = 160;

/** Разбор сообщений Socket.IO от сервера: всё внешнее считается недоверенным. */
export const normalizeChatMessage = (payload: unknown): ChatMessage | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  if (typeof source.id !== "string" || source.id.length === 0 || source.id.length > 128) return null;
  if (typeof source.userId !== "string" || source.userId.length === 0 || source.userId.length > 128) return null;

  const createdAtRaw = source.createdAt;
  const createdAt =
    typeof createdAtRaw === "number"
      ? Math.trunc(createdAtRaw)
      : typeof createdAtRaw === "string" && /^\d{1,16}$/.test(createdAtRaw)
        ? Number(createdAtRaw)
        : NaN;

  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;

  const username = sanitizeDisplayName(source.username, `User #${source.userId.slice(-4)}`);
  const text = sanitizeChatText(source.text, CHAT_MAX_MESSAGE_LENGTH);
  if (!text) return null;

  return {
    id: source.id,
    userId: source.userId,
    username,
    avatarUrl: sanitizeAvatarUrl(source.avatarUrl),
    text,
    createdAt
  };
};

export const normalizeChatSendAck = (payload: unknown): ChatSendAck | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  if (source.ok === true) {
    const message = normalizeChatMessage(source.message);
    if (!message) return null;
    if (typeof source.nextMessageAtMs !== "number" || !Number.isFinite(source.nextMessageAtMs)) return null;
    return {
      ok: true,
      message,
      nextMessageAtMs: Math.trunc(source.nextMessageAtMs)
    };
  }

  if (source.ok !== false || typeof source.error !== "string" || typeof source.code !== "string") {
    return null;
  }

  const knownCodes = [
    "UNAUTHORIZED",
    "INVALID_PAYLOAD",
    "EMPTY_MESSAGE",
    "COOLDOWN",
    "RATE_LIMIT",
    "MUTED",
    "STOPPED"
  ] as const;
  type KnownCode = (typeof knownCodes)[number];
  const code: KnownCode = (knownCodes as readonly string[]).includes(source.code)
    ? (source.code as KnownCode)
    : "INVALID_PAYLOAD";

  const retryAfterMs =
    typeof source.retryAfterMs === "number" && Number.isFinite(source.retryAfterMs) && source.retryAfterMs > 0
      ? Math.trunc(source.retryAfterMs)
      : undefined;
  const mutedUntilMs =
    typeof source.mutedUntilMs === "number" && Number.isFinite(source.mutedUntilMs) && source.mutedUntilMs > 0
      ? Math.trunc(source.mutedUntilMs)
      : undefined;

  return {
    ok: false,
    code,
    error: source.error,
    retryAfterMs,
    mutedUntilMs
  };
};

export const normalizeChatHistoryAck = (payload: unknown): ChatHistoryAck | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  if (source.ok === true && Array.isArray(source.messages)) {
    const messages = source.messages
      .map((item) => normalizeChatMessage(item))
      .filter((item): item is ChatMessage => item !== null)
      .slice(-CHAT_HISTORY_LIMIT);
    return {
      ok: true,
      messages
    };
  }

  if (source.ok === false && typeof source.code === "string" && typeof source.error === "string") {
    return {
      ok: false,
      code: source.code,
      error: source.error
    };
  }

  return null;
};

export const normalizeChatDeleteAck = (payload: unknown): ChatDeleteAck | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  if (source.ok === true && typeof source.messageId === "string") {
    return {
      ok: true,
      messageId: source.messageId
    };
  }

  if (source.ok === false && typeof source.code === "string" && typeof source.error === "string") {
    return {
      ok: false,
      code: source.code,
      error: source.error
    };
  }

  return null;
};

export const normalizeChatToggleAck = (payload: unknown): ChatToggleAck | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  if (source.ok === true && typeof source.sendingEnabled === "boolean") {
    return {
      ok: true,
      sendingEnabled: source.sendingEnabled
    };
  }

  if (source.ok === false && typeof source.code === "string" && typeof source.error === "string") {
    return {
      ok: false,
      code: source.code,
      error: source.error
    };
  }

  return null;
};

export const normalizeChatStatusPayload = (payload: unknown): { sendingEnabled: boolean } | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;
  if (typeof source.sendingEnabled !== "boolean") return null;
  return { sendingEnabled: source.sendingEnabled };
};

export const normalizeChatRolePayload = (payload: unknown): { isAdmin: boolean } | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;
  if (typeof source.isAdmin !== "boolean") return null;
  return { isAdmin: source.isAdmin };
};
