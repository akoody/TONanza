import Fastify from "fastify";
import { env } from "./config/env.js";
import { registerDevRoutes } from "./dev-helper.js";
import { registerSecurity } from "./http/security.js";
import { registerGameRoutes } from "./http/routes/games.js";
import { registerPaymentRoutes } from "./http/routes/payments.js";
import { registerReferralRoutes } from "./http/routes/referrals.js";
import { registerUserRoutes } from "./http/routes/users.js";
import { prisma } from "./lib/prisma.js";
import { createSocketServer, registerSocketHandlers } from "./realtime/socket.js";
import { createServices } from "./services.js";

/** Собирает приложение без запуска фоновых задач и прослушивания порта. */
export async function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: 1_048_576,
    trustProxy: env.TRUST_PROXY_HEADERS
  });

  await registerSecurity(app);

  const io = createSocketServer(app);
  const services = createServices(app, io);
  const { chatService, gameService, payoutService, roundScheduler, walletWatcher, botService } = services;

  registerSocketHandlers(app, io, chatService);

  app.get("/health", async () => ({ ok: true }));

  registerGameRoutes(app, services);
  registerUserRoutes(app, services);
  registerPaymentRoutes(app, services);
  registerReferralRoutes(app, io);

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

  return { app, start };
}
