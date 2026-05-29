import cors from "@fastify/cors";
import Fastify, { type FastifyRequest } from "fastify";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { z, ZodError } from "zod";
import { ChatService, type ChatUserContext } from "./chat/chat.service.js";
import { env } from "./config/env.js";
import { registerDevRoutes } from "./dev-helper.js";
import { cancelBetSchema, gameIdParamSchema, placeBetSchema } from "./game/game.schemas.js";
import { userSyncSchema } from "./game/user.schemas.js";
import { GameService } from "./game/game.service.js";
import { prisma } from "./lib/prisma.js";
import { RoundScheduler } from "./round/round.scheduler.js";
import { AppError } from "./shared/errors.js";
import { toJsonSafe } from "./shared/json.js";
import { FixedWindowRateLimiter } from "./shared/rate-limit.js";
import { validateTelegramWebAppData } from "./shared/telegram-auth.js";
import { BotService } from "./bot/bot.service.js";
import { TonEntropyService } from "./wallet/ton-entropy.service.js";
import { PayoutService } from "./wallet/payout.service.js";
import { WalletWatcherService } from "./wallet/wallet-watcher.service.js";
import { Prisma } from "@prisma/client";

type LockedUserRow = {
  id: bigint;
  balance_nanotons: bigint;
  referral_balance_nanotons: bigint;
};

const normalizeOrigin = (origin: string): string | null => {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
};

const allowedOrigins = new Set<string>();
const frontendOrigin = normalizeOrigin(env.FRONTEND_URL);
if (frontendOrigin) {
  allowedOrigins.add(frontendOrigin);
}
if (env.NODE_ENV !== "production") {
  allowedOrigins.add("http://localhost:5173");
  allowedOrigins.add("http://127.0.0.1:5173");
  allowedOrigins.add("http://localhost:3000");
  allowedOrigins.add("http://127.0.0.1:3000");
}

const isOriginAllowed = (origin?: string): boolean => {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowedOrigins.has(normalized);
};

const normalizeIp = (value: string | undefined | null): string => {
  if (!value) return "unknown";
  const first = value.split(",")[0]?.trim() ?? "";
  if (!first) return "unknown";
  return first.startsWith("::ffff:") ? first.slice(7) : first;
};

const extractForwardedIp = (headers: Record<string, unknown>): string | null => {
  const xForwardedFor = headers["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor.trim().length > 0) {
    return normalizeIp(xForwardedFor);
  }
  if (Array.isArray(xForwardedFor) && typeof xForwardedFor[0] === "string") {
    return normalizeIp(xForwardedFor[0]);
  }

  const xRealIp = headers["x-real-ip"];
  if (typeof xRealIp === "string" && xRealIp.trim().length > 0) {
    return normalizeIp(xRealIp);
  }
  if (Array.isArray(xRealIp) && typeof xRealIp[0] === "string") {
    return normalizeIp(xRealIp[0]);
  }

  return null;
};

const app = Fastify({
  logger: true,
  bodyLimit: 1_048_576,
  trustProxy: env.TRUST_PROXY_HEADERS
});

await app.register(cors, {
  origin: (origin, callback) => {
    callback(null, isOriginAllowed(origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "X-Telegram-Init-Data",
    "x-bypass-auth",
    "x-dev-user-id"
  ],
  maxAge: 86_400
});

app.addHook("onSend", async (_request, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  reply.header("Cross-Origin-Opener-Policy", "same-origin");
  reply.header("Cross-Origin-Resource-Policy", "same-site");
  reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if (env.NODE_ENV === "production") {
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return payload;
});

const httpRateLimiter = new FixedWindowRateLimiter({
  windowMs: env.HTTP_RATE_LIMIT_WINDOW_MS,
  maxInWindow: env.HTTP_RATE_LIMIT_MAX_REQUESTS,
  blockDurationMs: env.HTTP_RATE_LIMIT_BLOCK_MS,
  stateTtlMs: env.HTTP_RATE_LIMIT_STATE_TTL_MS
});

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

const getFastifyClientIp = (request: FastifyRequest): string => {
  if (env.TRUST_PROXY_HEADERS) {
    const forwarded = extractForwardedIp(request.headers as Record<string, unknown>);
    if (forwarded) return forwarded;
  }
  return normalizeIp(request.ip);
};

app.addHook("onRequest", async (request, reply) => {
  if (!env.HTTP_RATE_LIMIT_ENABLED) return;

  const path = request.url.split("?")[0];
  if (path === "/health") return;

  const ip = getFastifyClientIp(request);
  const decision = httpRateLimiter.consume(`http:${ip}`);
  if (decision.allowed) return;

  const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
  request.log.warn({ ip, path, retryAfterSec }, "HTTP rate limit exceeded");
  reply
    .status(429)
    .header("Retry-After", retryAfterSec.toString())
    .send({
      message: "Too many requests. Please slow down."
    });
});

const getSocketRequestIp = (request: {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string | null };
  connection?: { remoteAddress?: string | null };
}): string => {
  if (env.TRUST_PROXY_HEADERS) {
    const forwarded = extractForwardedIp(request.headers);
    if (forwarded) return forwarded;
  }

  const remoteAddress =
    request.socket?.remoteAddress ??
    request.connection?.remoteAddress ??
    null;
  return normalizeIp(remoteAddress);
};

const io = new SocketIOServer(app.server, {
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

const botService = new BotService();

const gameService = new GameService(prisma, {
  roundDurationSeconds: env.ROUND_DURATION_SECONDS,
  rakeBps: env.GAME_RAKE_BPS,
  minBetNanotons: env.MIN_BET_NANOTONS,
  io,
  notifyPrizeClaimed: async ({ telegramId, gameId }) => {
    const result = await botService.sendGameWonMessage(telegramId, gameId);
    if (!result.sent) {
      app.log.warn({ telegramId: telegramId.toString(), gameId: gameId.toString(), reason: result.reason }, "Failed to send win notification");
    }
  }
});

const entropyService = new TonEntropyService(env.TONCENTER_BASE_URL, env.TONCENTER_API_KEY);

const walletWatcher = new WalletWatcherService(prisma, {
  walletAddress: env.APP_WALLET_ADDRESS,
  toncenterBaseUrl: env.TONCENTER_BASE_URL,
  toncenterApiKey: env.TONCENTER_API_KEY,
  pollIntervalMs: env.WATCHER_POLL_INTERVAL_MS,
  pollBatchSize: env.WATCHER_POLL_BATCH_SIZE,
  pollMaxPages: env.WATCHER_POLL_MAX_PAGES,
  catchupMaxPages: env.WATCHER_CATCHUP_MAX_PAGES,
  lockTtlMs: env.WATCHER_LOCK_TTL_MS,
  recoverFailedLimit: env.WATCHER_RECOVER_FAILED_LIMIT,
  io,
  notifyDepositCredited: async ({ telegramId, amountNanotons }) => {
    const result = await botService.sendDepositCreditedMessage(telegramId, amountNanotons);
    if (!result.sent) {
      app.log.warn({ telegramId: telegramId.toString(), amountNanotons: amountNanotons.toString(), reason: result.reason }, "Failed to send deposit notification");
    }
  }
});

const roundScheduler = new RoundScheduler(prisma, gameService, entropyService);

const payoutService = new PayoutService(prisma, {
  mnemonic: env.APP_WALLET_MNEMONIC || "",
  toncenterBaseUrl: env.TONCENTER_BASE_URL,
  toncenterApiKey: env.TONCENTER_API_KEY,
  io,
  notifyWithdrawalCompleted: async ({ telegramId, amountNanotons }) => {
    const result = await botService.sendWithdrawalCompletedMessage(telegramId, amountNanotons);
    if (!result.sent) {
      app.log.warn({ telegramId: telegramId.toString(), amountNanotons: amountNanotons.toString(), reason: result.reason }, "Failed to send withdrawal notification");
    }
  }
});

const chatService = new ChatService(io, prisma, {
  enabled: env.CHAT_ENABLED,
  cooldownMs: env.CHAT_COOLDOWN_MS,
  maxMessageLength: env.CHAT_MAX_MESSAGE_LENGTH,
  historyLimit: env.CHAT_HISTORY_LIMIT,
  bucketCapacity: env.CHAT_BUCKET_CAPACITY,
  bucketWindowMs: env.CHAT_BUCKET_WINDOW_MS,
  autoMuteMs: env.CHAT_AUTO_MUTE_MS,
  adminUserIds: env.CHAT_ADMIN_USER_IDS
});

const MAX_DB_BIGINT = 9_223_372_036_854_775_807n;

const withdrawalBodySchema = z.object({
  amountNanotons: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .transform((value) => BigInt(value))
    .refine((value) => value <= MAX_DB_BIGINT, "amountNanotons exceeds BIGINT range")
});

const resolveGameBodySchema = z.object({}).strict();

const paymentsHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(30)
});

type AuthIdentity = {
  telegramUserId: bigint;
  isDevBypass: boolean;
};

const parsePositiveBigInt = (value: unknown): bigint | null => {
  if (typeof value !== "string") return null;
  if (!/^[1-9]\d*$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const extractTelegramIdentity = (request: FastifyRequest): AuthIdentity => {
  const isDevBypass = env.NODE_ENV !== "production" && request.headers["x-bypass-auth"] === "true";

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

const getAuthenticatedUser = async (request: FastifyRequest) => {
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

type SocketAuthPayload = {
  initData?: string;
  devBypass?: boolean;
  devUserId?: string;
};

type SocketRuntimeData = {
  userId?: string;
  chatUser?: ChatUserContext;
  ip?: string;
};

const extractSocketTelegramId = (payload: SocketAuthPayload | undefined): bigint | null => {
  if (!payload) return null;

  const isDevBypass = env.NODE_ENV !== "production" && payload.devBypass === true;
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

const getSocketChatUser = (socket: Socket): ChatUserContext | null => {
  const data = socket.data as SocketRuntimeData;
  if (!data.chatUser || typeof data.chatUser.userId !== "string") {
    return null;
  }
  return data.chatUser;
};

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

app.get("/health", async () => {
  return { ok: true };
});

app.get("/v1/games/active", async (_request, reply) => {
  await gameService.ensureOpenGameExists();
  const openGame = await gameService.getActiveGamePublicView();
  if (!openGame) {
    throw new AppError(500, "Failed to load active game");
  }

  return reply.send(
    toJsonSafe({
      id: openGame.id,
      serverSeedHash: openGame.serverSeedHash,
      status: openGame.status,
      totalPotNanotons: openGame.totalPotNanotons,
      nextTicket: openGame.nextTicket,
      participantCount: openGame.participantCount,
      countdownStarted: openGame.countdownStarted,
      players: openGame.players,
      bets: openGame.bets,
      startsAt: openGame.startsAt,
      endsAt: openGame.endsAt
    })
  );
});

app.get("/v1/games/history", async (_request, reply) => {
  const history = await gameService.getGameHistory(20);
  return reply.send(toJsonSafe(history));
});

app.get("/v1/payments/history", async (request, reply) => {
  const { user } = await getAuthenticatedUser(request);
  const query = paymentsHistoryQuerySchema.parse(request.query ?? {});

  const [deposits, withdrawals] = await Promise.all([
    prisma.deposit.findMany({
      where: {
        userId: user.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.limit,
      select: {
        id: true,
        amountNanotons: true,
        status: true,
        txHash: true,
        comment: true,
        sourceAddress: true,
        createdAt: true,
        confirmedAt: true
      }
    }),
    prisma.withdrawal.findMany({
      where: {
        userId: user.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.limit,
      select: {
        id: true,
        amountNanotons: true,
        status: true,
        txHash: true,
        toAddress: true,
        notes: true,
        createdAt: true,
        updatedAt: true
      }
    })
  ]);

  const merged = [
    ...deposits.map((deposit) => ({
      kind: "DEPOSIT" as const,
      id: deposit.id,
      amountNanotons: deposit.amountNanotons,
      status: deposit.status,
      txHash: deposit.txHash,
      comment: deposit.comment,
      sourceAddress: deposit.sourceAddress,
      createdAt: deposit.createdAt,
      updatedAt: deposit.confirmedAt ?? deposit.createdAt
    })),
    ...withdrawals.map((withdrawal) => ({
      kind: "WITHDRAWAL" as const,
      id: withdrawal.id,
      amountNanotons: withdrawal.amountNanotons,
      status: withdrawal.status,
      txHash: withdrawal.txHash,
      toAddress: withdrawal.toAddress,
      notes: withdrawal.notes,
      createdAt: withdrawal.createdAt,
      updatedAt: withdrawal.updatedAt
    }))
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, query.limit);

  return reply.send(toJsonSafe(merged));
});

app.post("/v1/bets", async (request, reply) => {
  const body = placeBetSchema.parse(request.body);
  const { user } = await getAuthenticatedUser(request);

  if (body.userId !== user.id) {
    request.log.warn(
      {
        bodyUserId: body.userId.toString(),
        authenticatedUserId: user.id.toString()
      },
      "Bet userId mismatch. Using authenticated user id"
    );
  }

  const result = await gameService.placeBet(user.id, body.amountNanotons);
  return reply.send(toJsonSafe(result));
});

app.post("/v1/bets/cancel", async (request, reply) => {
  const body = cancelBetSchema.parse(request.body);
  const { user } = await getAuthenticatedUser(request);

  if (body.userId !== user.id) {
    request.log.warn(
      {
        bodyUserId: body.userId.toString(),
        authenticatedUserId: user.id.toString()
      },
      "Cancel userId mismatch. Using authenticated user id"
    );
  }

  const result = await gameService.cancelSoloBet(user.id);
  return reply.send(toJsonSafe(result));
});

app.post("/v1/users/sync", async (request, reply) => {
  const identity = extractTelegramIdentity(request);
  const body = userSyncSchema.parse(request.body);

  if (identity.telegramUserId !== body.telegramId) {
    request.log.warn(
      {
        authId: identity.telegramUserId.toString(),
        bodyId: body.telegramId.toString()
      },
      "Auth ID mismatch - correcting to authenticated ID"
    );
    body.telegramId = identity.telegramUserId;
  }

  const defaultBootstrapBalance = 0n;

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: {
        telegramId: body.telegramId
      }
    });

    if (existing) {
      const shouldBootstrapInDev =
        env.NODE_ENV !== "production" &&
        defaultBootstrapBalance > 0n &&
        existing.balanceNanotons === 0n;

      const hasChanges =
        (body.walletAddress && existing.walletAddress !== body.walletAddress) ||
        (body.username && existing.username !== body.username) ||
        (body.avatarUrl && existing.avatarUrl !== body.avatarUrl);

      if (hasChanges) {
        return tx.user.update({
          where: { id: existing.id },
          data: {
            walletAddress: body.walletAddress ?? existing.walletAddress,
            username: body.username ?? existing.username,
            avatarUrl: body.avatarUrl ?? existing.avatarUrl,
            ...(shouldBootstrapInDev ? { balanceNanotons: defaultBootstrapBalance } : {})
          }
        });
      }

      if (shouldBootstrapInDev) {
        return tx.user.update({
          where: { id: existing.id },
          data: { balanceNanotons: defaultBootstrapBalance }
        });
      }

      return existing;
    }

    let referrerId: bigint | null = null;
    if (body.startParam && body.startParam.startsWith("ref_")) {
      const referrerTelegramId = parsePositiveBigInt(body.startParam.replace("ref_", ""));
      if (referrerTelegramId && referrerTelegramId !== body.telegramId) {
        const referrerUser = await tx.user.findUnique({
          where: { telegramId: referrerTelegramId }
        });
        if (referrerUser) {
          referrerId = referrerUser.id;
        }
      }
    }

    return tx.user.create({
      data: {
        telegramId: body.telegramId,
        walletAddress: body.walletAddress,
        username: body.username,
        avatarUrl: body.avatarUrl,
        balanceNanotons: defaultBootstrapBalance,
        referrerId: referrerId
      }
    });
  });

  const pendingPrizeSettlement = await gameService.settlePendingPrizesForUser(user.id);
  const effectiveBalanceNanotons =
    pendingPrizeSettlement.claimedGameIds.length > 0
      ? pendingPrizeSettlement.balanceNanotons
      : user.balanceNanotons;

  return reply.send(
    toJsonSafe({
      id: user.id,
      telegramId: user.telegramId,
      walletAddress: user.walletAddress,
      username: user.username,
      avatarUrl: user.avatarUrl,
      balanceNanotons: effectiveBalanceNanotons,
      settledPrizeNanotons: pendingPrizeSettlement.claimedNanotons,
      settledPrizeGameIds: pendingPrizeSettlement.claimedGameIds
    })
  );
});

app.get("/v1/referrals/info", async (request, reply) => {
  const { user } = await getAuthenticatedUser(request);

  const referralsCount = await prisma.user.count({
    where: { referrerId: user.id }
  });

  let tierPercentage = 15;
  if (referralsCount === 0) tierPercentage = 0;
  else if (referralsCount >= 101) tierPercentage = 30;
  else if (referralsCount >= 26) tierPercentage = 25;
  else if (referralsCount >= 6) tierPercentage = 20;

  const hasReferrer = Boolean(user.referrerId);
  const referredBy = user.referrerId
    ? await prisma.user.findUnique({
      where: { id: user.referrerId },
      select: { telegramId: true, username: true }
    })
    : null;

  return reply.send(
    toJsonSafe({
      referralsCount,
      tierPercentage,
      hasReferrer,
      selfBetRakebackMinPercentage: hasReferrer ? 2 : 0,
      selfBetRakebackMaxPercentage: hasReferrer ? 5 : 0,
      referredBy,
      referralBalanceNanotons: user.referralBalanceNanotons
    })
  );
});

app.post("/v1/referrals/claim", async (request, reply) => {
  const { user } = await getAuthenticatedUser(request);

  if (user.referralBalanceNanotons <= 0n) {
    throw new AppError(400, "No referral balance to claim");
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const lockedUser = await tx.$queryRaw<LockedUserRow[]>(
        Prisma.sql`
          SELECT id, balance_nanotons, referral_balance_nanotons
          FROM users
          WHERE id = ${user.id}
          FOR UPDATE
        `
      );

      if (!lockedUser[0]) {
        throw new AppError(404, "User not found");
      }

      // the struct doesn't have referral_balance_nanotons explicitly defined in LockedUserRow but we queried it. Let's just update safely
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          balanceNanotons: {
            increment: user.referralBalanceNanotons
          },
          referralBalanceNanotons: 0n
        },
        select: {
          balanceNanotons: true,
          referralBalanceNanotons: true
        }
      });

      return updated;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000
    }
  );

  io.to(`user:${user.id}`).emit("user:balance", result.balanceNanotons.toString());

  return reply.send(
    toJsonSafe({
      balanceNanotons: result.balanceNanotons,
      referralBalanceNanotons: result.referralBalanceNanotons
    })
  );
});

app.post("/v1/games/:gameId/resolve", async (request, reply) => {
  await getAuthenticatedUser(request);

  const params = gameIdParamSchema.parse(request.params);
  resolveGameBodySchema.parse(request.body ?? {});
  const clientSeed = await entropyService.getClientSeed();

  const result = await gameService.determineWinner(params.gameId, clientSeed);
  return reply.send(toJsonSafe(result));
});

app.post("/v1/games/:gameId/claim", async (request, reply) => {
  const { user } = await getAuthenticatedUser(request);

  const params = gameIdParamSchema.parse(request.params);
  resolveGameBodySchema.parse(request.body ?? {});

  const result = await gameService.claimGamePrize(params.gameId, user.id);
  return reply.send(toJsonSafe(result));
});

app.get("/v1/games/:gameId/fairness", async (request, reply) => {
  const params = gameIdParamSchema.parse(request.params);
  const result = await gameService.getGameFairness(params.gameId);
  return reply.send(toJsonSafe(result));
});

app.post("/v1/watcher/poll", async (_request, reply) => {
  if (env.NODE_ENV === "production") {
    throw new AppError(403, "Watcher poll endpoint is disabled in production");
  }

  await walletWatcher.pollOnce();
  return reply.send({ ok: true });
});

app.get("/v1/users/me", async (request, reply) => {
  const { user } = await getAuthenticatedUser(request);
  const pendingPrizeSettlement = await gameService.settlePendingPrizesForUser(user.id);
  const effectiveBalanceNanotons =
    pendingPrizeSettlement.claimedGameIds.length > 0
      ? pendingPrizeSettlement.balanceNanotons
      : user.balanceNanotons;

  return reply.send(toJsonSafe({
    id: user.id,
    telegramId: user.telegramId,
    walletAddress: user.walletAddress,
    username: user.username,
    avatarUrl: user.avatarUrl,
    balanceNanotons: effectiveBalanceNanotons,
    settledPrizeNanotons: pendingPrizeSettlement.claimedNanotons,
    settledPrizeGameIds: pendingPrizeSettlement.claimedGameIds
  }));
});

app.post("/v1/telegram/bootstrap-chat", async (request, reply) => {
  const identity = extractTelegramIdentity(request);
  const result = await botService.sendChatBootstrapMessage(identity.telegramUserId);

  return reply.send({
    ok: true,
    sent: result.sent,
    reason: result.reason ?? null
  });
});

app.post("/v1/withdrawals", async (request, reply) => {
  const { user: authenticatedUser } = await getAuthenticatedUser(request);
  const body = withdrawalBodySchema.parse(request.body);
  const amount = body.amountNanotons;

  if (amount < 100_000_000n) {
    throw new AppError(400, "Minimum withdrawal is 0.1 TON");
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: authenticatedUser.id } });
    if (!user) throw new AppError(404, "User not found");

    if (!user.walletAddress) {
      throw new AppError(400, "No wallet linked. Connect a TON wallet first.");
    }

    if (user.balanceNanotons < amount) {
      throw new AppError(400, "Insufficient balance");
    }

    return tx.withdrawal.create({
      data: {
        userId: user.id,
        amountNanotons: amount,
        toAddress: user.walletAddress,
        status: "PENDING"
      }
    });
  });

  void payoutService.processWithdrawal(result.id).catch((error) => {
    request.log.error({ err: error }, "Payout process failed trigger");
  });

  return reply.send(toJsonSafe(result));
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: "Validation failed",
      issues: error.issues
    });
  }

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      message: error.message
    });
  }

  request.log.error({ err: error }, "Unhandled error");
  return reply.status(500).send({
    message: "Internal server error"
  });
});

app.addHook("onClose", async () => {
  walletWatcher.stop();
  roundScheduler.stop();
  io.close();
  await prisma.$disconnect();
});

const start = async () => {
  await prisma.$connect();
  await gameService.ensureOpenGameExists();
  await payoutService.init();
  await chatService.init();

  walletWatcher.start();
  roundScheduler.start();
  void botService.start();

  await registerDevRoutes(app, io);

  await app.listen({
    host: "0.0.0.0",
    port: env.PORT
  });
};

start().catch((error) => {
  app.log.error({ err: error }, "Failed to start server");
  process.exit(1);
});
