import Fastify from "fastify";
import { prisma } from "./lib/prisma.js";
import { env } from "./config/env.js";
import { Server as SocketIOServer } from "socket.io";

// This file is used to manually trigger balance updates for testing purposes
// It mimics the behavior of the real backend services

export async function registerDevRoutes(app: Fastify.FastifyInstance, io: SocketIOServer) {
    if (env.NODE_ENV === "production") return;

    app.post<{ Body: { userId: string; amountNanotons: string } }>("/v1/dev/min-balance", async (request, reply) => {
        const { userId, amountNanotons } = request.body;
        const amount = BigInt(amountNanotons);

        const user = await prisma.user.update({
            where: { id: BigInt(userId) },
            data: {
                balanceNanotons: {
                    increment: amount
                }
            }
        });

        io.to(`user:${userId}`).emit("user:balance", user.balanceNanotons.toString());

        return { ok: true, balance: user.balanceNanotons.toString() };
    });
}
