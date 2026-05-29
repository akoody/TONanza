import type { Server as SocketIOServer, Socket } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import {
  chatDeletePayloadSchema,
  chatSendPayloadSchema,
  chatTogglePayloadSchema
} from "./chat.schemas.js";
import {
  sanitizeChatAvatarUrl,
  sanitizeChatDisplayName,
  sanitizeChatText
} from "./chat.moderation.js";

const VIOLATION_RESET_MS = 60_000;
const USER_STATE_TTL_MS = 6 * 60 * 60 * 1000;

export type ChatUserContext = {
  userId: string;
  username: string;
  avatarUrl?: string;
  isAdmin?: boolean;
};

export type ChatMessage = {
  id: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  text: string;
  createdAt: number;
};

export type ChatSendAck =
  | {
      ok: true;
      message: ChatMessage;
      nextMessageAtMs: number;
    }
  | {
      ok: false;
      code:
        | "UNAUTHORIZED"
        | "INVALID_PAYLOAD"
        | "EMPTY_MESSAGE"
        | "COOLDOWN"
        | "RATE_LIMIT"
        | "MUTED"
        | "STOPPED";
      error: string;
      retryAfterMs?: number;
      mutedUntilMs?: number;
    };

export type ChatDeleteAck =
  | {
      ok: true;
      messageId: string;
    }
  | {
      ok: false;
      code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_PAYLOAD" | "NOT_FOUND";
      error: string;
    };

export type ChatToggleAck =
  | {
      ok: true;
      sendingEnabled: boolean;
    }
  | {
      ok: false;
      code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_PAYLOAD";
      error: string;
    };

export type ChatStatusPayload = {
  sendingEnabled: boolean;
};

type UserState = {
  lastMessageAtMs: number;
  tokens: number;
  bucketUpdatedAtMs: number;
  muteUntilMs: number;
  violations: number;
  violationsUpdatedAtMs: number;
  lastActivityAtMs: number;
};

export class ChatService {
  private readonly history: ChatMessage[] = [];
  private readonly userState = new Map<string, UserState>();
  private persistenceReady = false;
  private seq = 0;
  private requestCounter = 0;
  private sendingEnabled = true;

  constructor(
    private readonly io: SocketIOServer,
    private readonly prisma: PrismaClient,
    private readonly config: {
      enabled: boolean;
      cooldownMs: number;
      maxMessageLength: number;
      historyLimit: number;
      bucketCapacity: number;
      bucketWindowMs: number;
      autoMuteMs: number;
      adminUserIds: string[];
    }
  ) {
    this.sendingEnabled = this.config.enabled;
  }

  isEnabled() {
    return this.config.enabled;
  }

  isSendingEnabled() {
    return this.config.enabled && this.sendingEnabled;
  }

  getStatus(): ChatStatusPayload {
    return {
      sendingEnabled: this.isSendingEnabled()
    };
  }

  isAdminUser(userId: string): boolean {
    return this.config.adminUserIds.includes(userId);
  }

  async init() {
    if (!this.config.enabled) {
      this.persistenceReady = false;
      return;
    }

    try {
      const persisted = await this.prisma.chatMessage.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: this.config.historyLimit
      });

      const recentMessages = persisted
        .reverse()
        .map((message): ChatMessage => ({
          id: message.id,
          userId: message.userId,
          username: message.username,
          avatarUrl: message.avatarUrl ?? undefined,
          text: message.text,
          createdAt: message.createdAt.getTime()
        }));

      this.history.splice(0, this.history.length, ...recentMessages);
      this.persistenceReady = true;
    } catch (error) {
      this.persistenceReady = false;
      console.error("[chat] failed to initialize persistent history, using in-memory history only", error);
    }
  }

  getHistory(): ChatMessage[] {
    return this.history;
  }

  emitHistoryToSocket(socket: Socket) {
    if (!this.config.enabled) return;
    socket.emit("chat:history", this.history);
  }

  emitStatusToSocket(socket: Socket) {
    if (!this.config.enabled) return;
    socket.emit("chat:status", this.getStatus());
  }

  sendFromSocket(input: unknown, user: ChatUserContext | null): ChatSendAck {
    if (!this.config.enabled) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Chat is disabled"
      };
    }

    if (!user) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Authentication required"
      };
    }

    if (!this.sendingEnabled) {
      return {
        ok: false,
        code: "STOPPED",
        error: "Chat is stopped by admin"
      };
    }

    const parsed = chatSendPayloadSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        error: "Invalid payload"
      };
    }

    const text = sanitizeChatText(parsed.data.text, this.config.maxMessageLength);
    if (!text) {
      return {
        ok: false,
        code: "EMPTY_MESSAGE",
        error: "Message is empty"
      };
    }

    const now = Date.now();
    const state = this.getUserState(user.userId, now);

    if (state.muteUntilMs > now) {
      return {
        ok: false,
        code: "MUTED",
        error: "Temporarily muted for spam",
        mutedUntilMs: state.muteUntilMs,
        retryAfterMs: state.muteUntilMs - now
      };
    }

    const cooldownRemaining = this.config.cooldownMs - (now - state.lastMessageAtMs);
    if (cooldownRemaining > 0) {
      this.registerViolation(state, now);
      return {
        ok: false,
        code: state.muteUntilMs > now ? "MUTED" : "COOLDOWN",
        error: state.muteUntilMs > now ? "Temporarily muted for spam" : "Message cooldown is active",
        retryAfterMs: state.muteUntilMs > now ? state.muteUntilMs - now : cooldownRemaining,
        mutedUntilMs: state.muteUntilMs > now ? state.muteUntilMs : undefined
      };
    }

    const refillRate = this.config.bucketCapacity / this.config.bucketWindowMs;
    const elapsedMs = Math.max(0, now - state.bucketUpdatedAtMs);
    state.tokens = Math.min(this.config.bucketCapacity, state.tokens + elapsedMs * refillRate);
    state.bucketUpdatedAtMs = now;

    if (state.tokens < 1) {
      this.registerViolation(state, now);
      const missingTokens = Math.max(0, 1 - state.tokens);
      const retryAfterMs = Math.ceil((missingTokens * this.config.bucketWindowMs) / this.config.bucketCapacity);
      return {
        ok: false,
        code: state.muteUntilMs > now ? "MUTED" : "RATE_LIMIT",
        error: state.muteUntilMs > now ? "Temporarily muted for spam" : "Too many messages",
        retryAfterMs: state.muteUntilMs > now ? state.muteUntilMs - now : retryAfterMs,
        mutedUntilMs: state.muteUntilMs > now ? state.muteUntilMs : undefined
      };
    }

    state.tokens -= 1;
    state.lastMessageAtMs = now;
    state.lastActivityAtMs = now;
    state.violations = 0;
    state.violationsUpdatedAtMs = now;

    const fallback = `User #${user.userId.slice(-4)}`;
    const message: ChatMessage = {
      id: this.createMessageId(now),
      userId: user.userId,
      username: sanitizeChatDisplayName(user.username, fallback),
      avatarUrl: sanitizeChatAvatarUrl(user.avatarUrl),
      text,
      createdAt: now
    };

    this.history.push(message);
    if (this.history.length > this.config.historyLimit) {
      this.history.splice(0, this.history.length - this.config.historyLimit);
    }

    this.io.emit("chat:new", message);

    this.requestCounter += 1;
    const shouldSweepUserState = this.requestCounter % 25 === 0;
    if (shouldSweepUserState) {
      this.sweepStaleUserState(now);
    }

    if (this.persistenceReady) {
      void this.persistMessage(message, shouldSweepUserState);
    }

    return {
      ok: true,
      message,
      nextMessageAtMs: now + this.config.cooldownMs
    };
  }

  async deleteFromSocket(input: unknown, user: ChatUserContext | null): Promise<ChatDeleteAck> {
    if (!this.config.enabled) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Chat is disabled"
      };
    }

    if (!user) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Authentication required"
      };
    }

    if (!this.canModerate(user)) {
      return {
        ok: false,
        code: "FORBIDDEN",
        error: "Admin access required"
      };
    }

    const parsed = chatDeletePayloadSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        error: "Invalid payload"
      };
    }

    const targetMessageId = parsed.data.messageId;
    const existingMessageIndex = this.history.findIndex((message) => message.id === targetMessageId);
    if (existingMessageIndex < 0) {
      return {
        ok: false,
        code: "NOT_FOUND",
        error: "Message not found"
      };
    }

    this.history.splice(existingMessageIndex, 1);
    this.io.emit("chat:deleted", { messageId: targetMessageId });

    try {
      await this.prisma.chatMessage.deleteMany({
        where: {
          id: targetMessageId
        }
      });
    } catch (error) {
      console.error("[chat] failed to delete chat message", error);
    }

    return {
      ok: true,
      messageId: targetMessageId
    };
  }

  toggleFromSocket(input: unknown, user: ChatUserContext | null): ChatToggleAck {
    if (!this.config.enabled) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Chat is disabled"
      };
    }

    if (!user) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Authentication required"
      };
    }

    if (!this.canModerate(user)) {
      return {
        ok: false,
        code: "FORBIDDEN",
        error: "Admin access required"
      };
    }

    const parsed = chatTogglePayloadSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        error: "Invalid payload"
      };
    }

    this.sendingEnabled = parsed.data.enabled;
    this.io.emit("chat:status", this.getStatus());

    return {
      ok: true,
      sendingEnabled: this.isSendingEnabled()
    };
  }

  private createMessageId(now: number) {
    this.seq = (this.seq + 1) % Number.MAX_SAFE_INTEGER;
    return `${now.toString(36)}-${this.seq.toString(36)}`;
  }

  private canModerate(user: ChatUserContext): boolean {
    return user.isAdmin === true || this.isAdminUser(user.userId);
  }

  private getUserState(userId: string, now: number): UserState {
    const existing = this.userState.get(userId);
    if (existing) {
      existing.lastActivityAtMs = now;
      return existing;
    }

    const created: UserState = {
      lastMessageAtMs: 0,
      tokens: this.config.bucketCapacity,
      bucketUpdatedAtMs: now,
      muteUntilMs: 0,
      violations: 0,
      violationsUpdatedAtMs: now,
      lastActivityAtMs: now
    };

    this.userState.set(userId, created);
    return created;
  }

  private registerViolation(state: UserState, now: number) {
    if (now - state.violationsUpdatedAtMs > VIOLATION_RESET_MS) {
      state.violations = 0;
    }

    state.violations += 1;
    state.violationsUpdatedAtMs = now;
    state.lastActivityAtMs = now;

    if (state.violations >= 3) {
      state.muteUntilMs = now + this.config.autoMuteMs;
      state.violations = 0;
      state.tokens = Math.min(state.tokens, 0);
    }
  }

  private sweepStaleUserState(now: number) {
    for (const [userId, state] of this.userState) {
      if (now - state.lastActivityAtMs > USER_STATE_TTL_MS && state.muteUntilMs <= now) {
        this.userState.delete(userId);
      }
    }
  }

  private async persistMessage(message: ChatMessage, trimHistory: boolean) {
    try {
      await this.prisma.chatMessage.upsert({
        where: { id: message.id },
        create: {
          id: message.id,
          userId: message.userId,
          username: message.username,
          avatarUrl: message.avatarUrl ?? null,
          text: message.text,
          createdAt: new Date(message.createdAt)
        },
        update: {
          userId: message.userId,
          username: message.username,
          avatarUrl: message.avatarUrl ?? null,
          text: message.text,
          createdAt: new Date(message.createdAt)
        }
      });

      if (trimHistory) {
        await this.trimPersistedHistory();
      }
    } catch (error) {
      console.error("[chat] failed to persist chat message", error);
    }
  }

  private async trimPersistedHistory() {
    if (this.config.historyLimit <= 0) return;

    const staleRows = await this.prisma.chatMessage.findMany({
      select: { id: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: this.config.historyLimit
    });

    if (staleRows.length === 0) {
      return;
    }

    await this.prisma.chatMessage.deleteMany({
      where: {
        id: {
          in: staleRows.map((row) => row.id)
        }
      }
    });
  }
}
