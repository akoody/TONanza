import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer, type Socket } from "socket.io";
import type { ChatService, ChatUserContext } from "../chat/chat.service.js";
import { env } from "../config/env.js";
import { extractSocketTelegramId, type SocketAuthPayload } from "../http/auth.js";
import { getSocketRequestIp, isOriginAllowed } from "../http/client-ip.js";
import { prisma } from "../lib/prisma.js";
import { FixedWindowRateLimiter } from "../shared/rate-limit.js";

type SocketRuntimeData = {
  userId?: string;
  chatUser?: ChatUserContext;
  ip?: string;
};

const getSocketChatUser = (socket: Socket): ChatUserContext | null => {
  const data = socket.data as SocketRuntimeData;
  if (!data.chatUser || typeof data.chatUser.userId !== "string") {
    return null;
  }
  return data.chatUser;
};

const socketConnectRateLimiter = new FixedWindowRateLimiter({
  windowMs: env.SOCKET_CONNECT_RATE_WINDOW_MS,
  maxInWindow: env.SOCKET_CONNECT_RATE_MAX_ATTEMPTS,
  blockDurationMs: env.SOCKET_CONNECT_RATE_BLOCK_MS,
  stateTtlMs: env.SOCKET_CONNECT_RATE_STATE_TTL_MS
});

const socketEventRateLimiter = new FixedWindowRateLimiter({
  windowMs: env.SOCKET_EVENT_RATE_WINDOW_MS,
  maxInWindow: env.SOCKET_EVENT_RATE_MAX_EVENTS,
  blockDurationMs: env.SOCKET_EVENT_RATE_BLOCK_MS,
  stateTtlMs: env.SOCKET_EVENT_RATE_STATE_TTL_MS
});

export function createSocketServer(app: FastifyInstance) {
  return new SocketIOServer(app.server, {
    cors: {
      origin: (origin, callback) => {
        callback(null, isOriginAllowed(origin));
      },
      methods: ["GET", "POST"]
    },
    allowRequest: (request, callback) => {
      if (!isOriginAllowed(request.headers.origin)) {
        callback("Origin not allowed", false);
        return;
      }

      if (env.SOCKET_CONNECT_RATE_LIMIT_ENABLED) {
        const ip = getSocketRequestIp(request as {
          headers: Record<string, unknown>;
          socket?: { remoteAddress?: string | null };
          connection?: { remoteAddress?: string | null };
        });
        const decision = socketConnectRateLimiter.consume(`socket-connect:${ip}`);
        if (!decision.allowed) {
          const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
          app.log.warn({ ip, retryAfterSec }, "Socket connection rate limit exceeded");
          callback("Too many connection attempts", false);
          return;
        }
      }

      callback(null, true);
    },

    maxHttpBufferSize: env.SOCKET_MAX_HTTP_BUFFER_SIZE,
    perMessageDeflate: false
  });
}

/** Подключения, авторизация сокета и события чата. */
export function registerSocketHandlers(app: FastifyInstance, io: SocketIOServer, chatService: ChatService) {
  io.on("connection", (socket) => {
    const socketIp = getSocketRequestIp({
      headers: socket.handshake.headers as Record<string, unknown>,
      // `socket.conn.transport.socket` isn't stable across transports, handshake address is enough.
      socket: { remoteAddress: socket.handshake.address }
    });
    const socketData = socket.data as SocketRuntimeData;
    socketData.ip = socketIp;

    if (env.SOCKET_EVENT_RATE_LIMIT_ENABLED) {
      socket.use((packet, next) => {
        const [eventName] = packet;
        if (typeof eventName !== "string") {
          next();
          return;
        }

        const decision = socketEventRateLimiter.consume(`socket-event:${socketIp}`);
        if (decision.allowed) {
          next();
          return;
        }

        const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
        app.log.warn({ socketId: socket.id, ip: socketIp, eventName, retryAfterSec }, "Socket event rate limit exceeded");
        socket.emit("chat:error", {
          ok: false,
          code: "RATE_LIMIT",
          error: "Too many socket events",
          retryAfterMs: decision.retryAfterMs
        });
        socket.disconnect(true);
        next(new Error("Socket rate limit exceeded"));
      });
    }

    const count = io.engine.clientsCount;
    io.emit("online_users", count);
    app.log.info({ socketId: socket.id, ip: socketIp, count }, "Socket connected");

    void (async () => {
      const payload = socket.handshake.auth as SocketAuthPayload | undefined;
      const telegramId = extractSocketTelegramId(payload);
      if (!telegramId) return;

      const user = await prisma.user.findUnique({
        where: {
          telegramId
        },
        select: {
          id: true,
          telegramId: true,
          username: true,
          avatarUrl: true
        }
      });

      if (!user) return;

      const authenticatedUserId = user.id.toString();
      const authenticatedTelegramId = user.telegramId.toString();
      const isChatAdmin =
        env.CHAT_ADMIN_USER_IDS.includes(authenticatedUserId) ||
        env.CHAT_ADMIN_USER_IDS.includes(authenticatedTelegramId);
      const fallbackName = `User #${user.telegramId.toString().slice(-4)}`;
      socketData.userId = authenticatedUserId;
      socketData.chatUser = {
        userId: authenticatedUserId,
        username: user.username || fallbackName,
        avatarUrl: user.avatarUrl || undefined,
        isAdmin: isChatAdmin
      };
      await socket.join(`user:${authenticatedUserId}`);
      app.log.info({ socketId: socket.id, userId: authenticatedUserId }, "Socket authenticated and joined user room");

      if (chatService.isEnabled()) {
        chatService.emitHistoryToSocket(socket);
        chatService.emitStatusToSocket(socket);
      }
      socket.emit("chat:role", { isAdmin: isChatAdmin });
    })().catch((error) => {
      app.log.warn({ socketId: socket.id, err: error }, "Socket auth initialization failed");
    });

    socket.on("chat:getHistory", (ack?: (response: unknown) => void) => {
      const chatUser = getSocketChatUser(socket);
      if (!chatUser || !chatService.isEnabled()) {
        if (typeof ack === "function") {
          ack({
            ok: false,
            code: "UNAUTHORIZED",
            error: "Authentication required"
          });
        }
        return;
      }

      const history = chatService.getHistory();
      if (typeof ack === "function") {
        ack({
          ok: true,
          messages: history
        });
        return;
      }

      socket.emit("chat:history", history);
    });

    socket.on("chat:send", (payload: unknown, ack?: (response: unknown) => void) => {
      const result = chatService.sendFromSocket(payload, getSocketChatUser(socket));

      if (!result.ok && typeof ack !== "function") {
        socket.emit("chat:error", result);
      }

      if (typeof ack === "function") {
        ack(result);
      }
    });

    socket.on("chat:getStatus", (ack?: (response: unknown) => void) => {
      const chatUser = getSocketChatUser(socket);
      if (!chatService.isEnabled() || !chatUser) {
        if (typeof ack === "function") {
          ack({
            ok: false,
            code: "UNAUTHORIZED",
            error: "Authentication required"
          });
        }
        return;
      }

      const status = chatService.getStatus();
      if (typeof ack === "function") {
        ack({
          ok: true,
          ...status
        });
      } else {
        socket.emit("chat:status", status);
      }
    });

    socket.on("chat:delete", (payload: unknown, ack?: (response: unknown) => void) => {
      void chatService.deleteFromSocket(payload, getSocketChatUser(socket)).then((result) => {
        if (!result.ok && typeof ack !== "function") {
          socket.emit("chat:error", result);
        }

        if (typeof ack === "function") {
          ack(result);
        }
      }).catch((error) => {
        app.log.error({ socketId: socket.id, err: error }, "chat:delete handler failed");
        const response = {
          ok: false,
          code: "INVALID_PAYLOAD",
          error: "Failed to delete message"
        };
        if (typeof ack === "function") {
          ack(response);
        } else {
          socket.emit("chat:error", response);
        }
      });
    });

    socket.on("chat:toggle", (payload: unknown, ack?: (response: unknown) => void) => {
      const result = chatService.toggleFromSocket(payload, getSocketChatUser(socket));
      if (!result.ok && typeof ack !== "function") {
        socket.emit("chat:error", result);
      }
      if (typeof ack === "function") {
        ack(result);
      }
    });

    socket.on("disconnect", () => {
      const newCount = io.engine.clientsCount;
      io.emit("online_users", newCount);
      app.log.info({ socketId: socket.id, count: newCount }, "Socket disconnected");
    });

    socket.on("join", (userId: string) => {
      const data = socket.data as SocketRuntimeData;
      const authenticatedUserId = typeof data.userId === "string" ? data.userId : null;
      if (!authenticatedUserId) {
        app.log.warn({ socketId: socket.id, requestedUserId: userId }, "Socket join denied: unauthenticated");
        return;
      }

      if (userId !== authenticatedUserId) {
        app.log.warn({ socketId: socket.id, requestedUserId: userId, authenticatedUserId }, "Socket join denied: user mismatch");
        return;
      }

      void socket.join(`user:${authenticatedUserId}`);
    });
  });
}
