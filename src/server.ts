import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyRequest } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server as SocketIOServer } from "socket.io";
import { ZodError } from "zod";
import { BotService } from "./bot/bot.service.js";
import { env } from "./config/env.js";
import { adminActionSchema, createDealSchema, dealCodeParamSchema, searchDealsSchema, sendMessageSchema } from "./deals/deal.schemas.js";
import { DealService } from "./deals/deal.service.js";
import { prisma } from "./lib/prisma.js";
import { AppError } from "./shared/errors.js";
import { toJsonSafe } from "./shared/json.js";
import { resolveTelegramAuth } from "./shared/telegram-auth.js";

const app = Fastify({
  logger: true,
  bodyLimit: 2_000_000
});

const allowedOrigins = new Set(
  [
    env.FRONTEND_URL,
    ...env.CORS_ORIGINS.split(","),
    env.NODE_ENV !== "production" ? "http://localhost:5173" : "",
    env.NODE_ENV !== "production" ? "http://127.0.0.1:5173" : ""
  ]
    .filter((origin): origin is string => typeof origin === "string")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const isOriginAllowed = (origin?: string) => {
  if (!origin) return true;
  if (allowedOrigins.size === 0 && env.NODE_ENV !== "production") return true;
  try {
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
};

await fs.mkdir(env.UPLOAD_DIR, { recursive: true });

await app.register(cors, {
  origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Telegram-Init-Data", "x-bypass-auth", "x-dev-user-id"],
  maxAge: 86_400
});

await app.register(multipart, {
  limits: {
    fileSize: env.MAX_UPLOAD_BYTES,
    files: 10
  }
});

await app.register(fastifyStatic, {
  root: path.resolve(env.UPLOAD_DIR),
  prefix: "/uploads/"
});

const io = new SocketIOServer(app.server, {
  cors: {
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: env.MAX_UPLOAD_BYTES
});

const botService = new BotService();
const dealService = new DealService(prisma, env.ADMIN_IDS);

const getCurrentUser = async (request: FastifyRequest) => {
  const auth = resolveTelegramAuth(request.headers as Record<string, unknown>, env.TELEGRAM_BOT_TOKEN);
  return dealService.upsertUser(auth);
};

const emitDeal = (deal: { code: string }, payload: unknown) => {
  io.to(`deal:${deal.code}`).emit("deal:update", toJsonSafe(payload));
};

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({ message: error.message, code: error.code });
    return;
  }
  if (error instanceof ZodError) {
    reply.status(400).send({ message: "Проверьте заполненные поля", code: "VALIDATION_ERROR", details: error.flatten() });
    return;
  }
  app.log.error(error);
  reply.status(500).send({ message: "Внутренняя ошибка сервера", code: "INTERNAL_ERROR" });
});

app.get("/health", async () => ({ ok: true }));

app.get("/v1/me", async (request) => {
  const user = await getCurrentUser(request);
  return toJsonSafe({
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    isAdmin: user.isAdmin
  });
});

app.get("/v1/deals", async (request) => {
  const user = await getCurrentUser(request);
  const query = searchDealsSchema.parse(request.query);
  return toJsonSafe(await dealService.listDeals(user, query.q));
});

app.post("/v1/deals", async (request) => {
  const user = await getCurrentUser(request);
  const body = createDealSchema.parse(request.body);
  const deal = await dealService.createDeal(user, body);
  emitDeal(deal, deal);
  return toJsonSafe(deal);
});

app.get("/v1/deals/:code", async (request) => {
  const user = await getCurrentUser(request);
  const params = dealCodeParamSchema.parse(request.params);
  return toJsonSafe(await dealService.getDealByCode(user, params.code));
});

app.post("/v1/deals/:code/messages", async (request) => {
  const user = await getCurrentUser(request);
  const params = dealCodeParamSchema.parse(request.params);
  const body = sendMessageSchema.parse(request.body);
  const deal = await dealService.addTextMessage(user, params.code, body.text);
  emitDeal(deal, deal);
  return toJsonSafe(deal);
});

app.post("/v1/deals/:code/photos", async (request) => {
  const user = await getCurrentUser(request);
  const params = dealCodeParamSchema.parse(request.params);
  const parts = request.files();
  const uploadedUrls: string[] = [];

  for await (const part of parts) {
    if (part.type !== "file") continue;
    if (!part.mimetype.startsWith("image/")) {
      throw new AppError(400, "Можно отправлять только изображения", "INVALID_FILE_TYPE");
    }
    if (uploadedUrls.length >= 10) {
      throw new AppError(400, "За раз можно отправить до 10 фото", "TOO_MANY_PHOTOS");
    }

    const extension = path.extname(part.filename).toLowerCase() || ".jpg";
    const safeExtension = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension) ? extension : ".jpg";
    const filename = `${Date.now()}-${cryptoRandom()}${safeExtension}`;
    const filepath = path.join(path.resolve(env.UPLOAD_DIR), filename);
    await fs.writeFile(filepath, await part.toBuffer());
    uploadedUrls.push(`/uploads/${filename}`);
  }

  if (uploadedUrls.length === 0) {
    throw new AppError(400, "Добавьте хотя бы одно фото", "PHOTO_REQUIRED");
  }

  let deal = await dealService.getDealByCode(user, params.code);
  for (const photoUrl of uploadedUrls) {
    deal = await dealService.addPhotoMessage(user, params.code, photoUrl);
  }
  emitDeal(deal, deal);
  return toJsonSafe(deal);
});

app.post("/v1/deals/:code/admin/requisites", async (request) => {
  const user = await getCurrentUser(request);
  const params = dealCodeParamSchema.parse(request.params);
  const body = adminActionSchema.parse(request.body);
  const deal = await dealService.addAdminRequisites(user, params.code, body.text);
  emitDeal(deal, deal);
  return toJsonSafe(deal);
});

app.post("/v1/deals/:code/admin/notify", async (request) => {
  const user = await getCurrentUser(request);
  const params = dealCodeParamSchema.parse(request.params);
  const body = adminActionSchema.parse(request.body);
  const deal = await dealService.addAdminNotification(user, params.code, body.text);

  const recipients = deal.participants
    .map((participant) => participant.user)
    .filter((participant) => !participant.isAdmin && participant.telegramId !== user.telegramId.toString());
  await Promise.allSettled(
    recipients.map((recipient) => botService.sendDealNotification(recipient.telegramId, deal.code, body.text))
  );

  emitDeal(deal, deal);
  return toJsonSafe(deal);
});

app.post("/v1/deals/:code/admin/close", async (request) => {
  const user = await getCurrentUser(request);
  const params = dealCodeParamSchema.parse(request.params);
  const deal = await dealService.closeDeal(user, params.code);
  emitDeal(deal, deal);
  return toJsonSafe(deal);
});

io.on("connection", (socket) => {
  const rawDealCode = socket.handshake.query.dealCode;
  const dealCode = typeof rawDealCode === "string" ? rawDealCode.trim().toUpperCase() : "";
  if (/^[A-F0-9]{8}$/.test(dealCode)) {
    socket.join(`deal:${dealCode}`);
  }
});

const cryptoRandom = () => Math.random().toString(36).slice(2, 10);

const shutdown = async () => {
  await botService.stop();
  await prisma.$disconnect();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await botService.start();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
