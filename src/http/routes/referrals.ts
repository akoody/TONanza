import type { FastifyInstance } from "fastify";
import type { Server as SocketIOServer } from "socket.io";
import { toJsonSafe } from "../../shared/json.js";
import { prisma } from "../../lib/prisma.js";
import { claimReferralBalance } from "../../referrals/referral.service.js";
import { getAuthenticatedUser } from "../auth.js";

export function registerReferralRoutes(app: FastifyInstance, io: SocketIOServer) {
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
    const result = await claimReferralBalance(prisma, user.id);

    io.to(`user:${user.id}`).emit("user:balance", result.balanceNanotons.toString());

    return reply.send(toJsonSafe(result));
  });
}
