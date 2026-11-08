import type { FastifyInstance } from "fastify";
import type { Services } from "../../services.js";
import { toJsonSafe } from "../../shared/json.js";
import { z } from "zod";
import { isDevToolsEnabled } from "../../config/env.js";
import { cancelBetSchema, gameIdParamSchema, placeBetSchema } from "../../game/game.schemas.js";
import { AppError } from "../../shared/errors.js";
import { getAuthenticatedUser } from "../auth.js";

const resolveGameBodySchema = z.object({}).strict();

export function registerGameRoutes(app: FastifyInstance, { gameService, entropyService, walletWatcher }: Services) {
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
    if (!isDevToolsEnabled) {
      throw new AppError(403, "Watcher poll endpoint is available only with dev tools enabled");
    }

    await walletWatcher.pollOnce();
    return reply.send({ ok: true });
  });
}
