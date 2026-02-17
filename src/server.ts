import cors from "@fastify/cors";
import Fastify from "fastify";
import { Server as SocketIOServer } from "socket.io";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { determineWinnerSchema, gameIdParamSchema, placeBetSchema } from "./game/game.schemas.js";
import { userSyncSchema } from "./game/user.schemas.js";
import { GameService } from "./game/game.service.js";
import { prisma } from "./lib/prisma.js";
import { RoundScheduler } from "./round/round.scheduler.js";
import { AppError } from "./shared/errors.js";
import { toJsonSafe } from "./shared/json.js";
import { TonEntropyService } from "./wallet/ton-entropy.service.js";
import { WalletWatcherService } from "./wallet/wallet-watcher.service.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const io = new SocketIOServer(app.server, {
  cors: {
    origin: true
  }
});

const gameService = new GameService(prisma, {
  roundDurationSeconds: env.ROUND_DURATION_SECONDS,
  io
});

const entropyService = new TonEntropyService(env.TONCENTER_BASE_URL, env.TONCENTER_API_KEY);

const walletWatcher = new WalletWatcherService(prisma, {
  walletAddress: env.APP_WALLET_ADDRESS,
  toncenterBaseUrl: env.TONCENTER_BASE_URL,
  toncenterApiKey: env.TONCENTER_API_KEY,
  pollIntervalMs: env.WATCHER_POLL_INTERVAL_MS
});

const roundScheduler = new RoundScheduler(prisma, gameService, entropyService);

io.on("connection", (socket) => {
  app.log.info({ socketId: socket.id }, "Socket connected");

  socket.on("disconnect", () => {
    app.log.info({ socketId: socket.id }, "Socket disconnected");
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
      startsAt: openGame.startsAt,
      endsAt: openGame.endsAt
    })
  );
});

app.post("/v1/bets", async (request, reply) => {
  const body = placeBetSchema.parse(request.body);
  const result = await gameService.placeBet(body.userId, body.amountNanotons);

  return reply.send(toJsonSafe(result));
});

app.post("/v1/users/sync", async (request, reply) => {
  const body = userSyncSchema.parse(request.body);
  const defaultBootstrapBalance =
    env.NODE_ENV === "production" ? 0n : env.DEV_BOOTSTRAP_BALANCE_NANOTONS;

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

      if (body.walletAddress && existing.walletAddress !== body.walletAddress) {
        return tx.user.update({
          where: { id: existing.id },
          data: {
            walletAddress: body.walletAddress,
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

    return tx.user.create({
      data: {
        telegramId: body.telegramId,
        walletAddress: body.walletAddress,
        balanceNanotons: defaultBootstrapBalance
      }
    });
  });

  return reply.send(
    toJsonSafe({
      id: user.id,
      telegramId: user.telegramId,
      walletAddress: user.walletAddress,
      balanceNanotons: user.balanceNanotons
    })
  );
});

app.post("/v1/games/:gameId/resolve", async (request, reply) => {
  const params = gameIdParamSchema.parse(request.params);
  const body = determineWinnerSchema.parse(request.body ?? {});
  const clientSeed = body.clientSeed ?? (await entropyService.getClientSeed());

  const result = await gameService.determineWinner(params.gameId, clientSeed);
  return reply.send(toJsonSafe(result));
});

app.get("/v1/games/:gameId/fairness", async (request, reply) => {
  const params = gameIdParamSchema.parse(request.params);
  const result = await gameService.getGameFairness(params.gameId);
  return reply.send(toJsonSafe(result));
});

app.post("/v1/watcher/poll", async (_request, reply) => {
  await walletWatcher.pollOnce();
  return reply.send({ ok: true });
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

  walletWatcher.start();
  roundScheduler.start();

  await app.listen({
    host: "0.0.0.0",
    port: env.PORT
  });
};

start().catch((error) => {
  app.log.error({ err: error }, "Failed to start server");
  process.exit(1);
});
