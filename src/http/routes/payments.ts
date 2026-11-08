import type { FastifyInstance } from "fastify";
import type { Services } from "../../services.js";
import { toJsonSafe } from "../../shared/json.js";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../shared/errors.js";
import { getAuthenticatedUser } from "../auth.js";

const MAX_DB_BIGINT = 9_223_372_036_854_775_807n;

const withdrawalBodySchema = z.object({
  amountNanotons: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .transform((value) => BigInt(value))
    .refine((value) => value <= MAX_DB_BIGINT, "amountNanotons exceeds BIGINT range")
});

const paymentsHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(30)
});

export function registerPaymentRoutes(app: FastifyInstance, { payoutService }: Services) {
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
}
