import { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../shared/errors.js";

/**
 * Переносит реферальный баланс на основной. Сумма читается под блокировкой
 * строки пользователя, поэтому параллельные запросы не зачислят её дважды.
 */
export async function claimReferralBalance(prisma: PrismaClient, userId: bigint) {
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ referral_balance_nanotons: bigint }>>(Prisma.sql`
      SELECT referral_balance_nanotons
      FROM users
      WHERE id = ${userId}
      FOR UPDATE
    `);

    if (!locked) {
      throw new AppError(404, "User not found");
    }

    if (locked.referral_balance_nanotons <= 0n) {
      throw new AppError(400, "No referral balance to claim");
    }

    return tx.user.update({
      where: { id: userId },
      data: {
        balanceNanotons: { increment: locked.referral_balance_nanotons },
        referralBalanceNanotons: 0n
      },
      select: { balanceNanotons: true, referralBalanceNanotons: true }
    });
  });
}
