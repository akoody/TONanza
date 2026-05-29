
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("--- Users ---");
    const users = await prisma.user.findMany();
    console.table(users.map(u => ({ ...u, id: u.id.toString(), telegramId: u.telegramId.toString(), balance: u.balanceNanotons.toString() })));

    console.log("\n--- Deposits (Last 10) ---");
    const deposits = await prisma.deposit.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { user: true }
    });
    console.table(deposits.map(d => ({
        id: d.id.toString(),
        txHash: d.txHash.substring(0, 10) + "...",
        amount: d.amountNanotons.toString(),
        status: d.status,
        comment: d.comment,
        userId: d.userId?.toString()
    })));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
