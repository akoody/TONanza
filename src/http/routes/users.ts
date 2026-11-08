import type { FastifyInstance } from "fastify";
import type { Services } from "../../services.js";
import { toJsonSafe } from "../../shared/json.js";
import { isDevToolsEnabled } from "../../config/env.js";
import { userSyncSchema } from "../../game/user.schemas.js";
import { prisma } from "../../lib/prisma.js";
import { extractTelegramIdentity, getAuthenticatedUser, parsePositiveBigInt } from "../auth.js";

export function registerUserRoutes(app: FastifyInstance, { gameService, botService }: Services) {
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
          isDevToolsEnabled &&
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
}
