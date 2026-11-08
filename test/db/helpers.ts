import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export const TON = 1_000_000_000n;

let nextTelegramId = 1000n;

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    "TRUNCATE users, games, bets, deposits, withdrawals RESTART IDENTITY CASCADE"
  );
}

export async function createUser(balanceNanotons = 0n, data: { referrerId?: bigint; referralBalanceNanotons?: bigint; walletAddress?: string } = {}) {
  nextTelegramId += 1n;
  return prisma.user.create({
    data: { telegramId: nextTelegramId, balanceNanotons, ...data }
  });
}

export async function balanceOf(userId: bigint) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return user.balanceNanotons;
}
