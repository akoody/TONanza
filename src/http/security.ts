import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../shared/errors.js";
import { FixedWindowRateLimiter } from "../shared/rate-limit.js";
import { getFastifyClientIp, isOriginAllowed } from "./client-ip.js";

/** CORS, заголовки безопасности, rate limit и единый формат ошибок. */
export async function registerSecurity(app: FastifyInstance) {
  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "X-Telegram-Init-Data",
      "x-bypass-auth",
      "x-dev-user-id"
    ],
    maxAge: 86_400
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-site");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return payload;
  });

  const httpRateLimiter = new FixedWindowRateLimiter({
    windowMs: env.HTTP_RATE_LIMIT_WINDOW_MS,
    maxInWindow: env.HTTP_RATE_LIMIT_MAX_REQUESTS,
    blockDurationMs: env.HTTP_RATE_LIMIT_BLOCK_MS,
    stateTtlMs: env.HTTP_RATE_LIMIT_STATE_TTL_MS
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!env.HTTP_RATE_LIMIT_ENABLED) return;

    const path = request.url.split("?")[0];
    if (path === "/health") return;

    const ip = getFastifyClientIp(request);
    const decision = httpRateLimiter.consume(`http:${ip}`);
    if (decision.allowed) return;

    const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    request.log.warn({ ip, path, retryAfterSec }, "HTTP rate limit exceeded");
    reply
      .status(429)
      .header("Retry-After", retryAfterSec.toString())
      .send({
        message: "Too many requests. Please slow down."
      });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        message: "Validation failed",
        issues: error.issues
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        message: error.message
      });
    }

    request.log.error({ err: error }, "Unhandled error");
    return reply.status(500).send({
      message: "Internal server error"
    });
  });
}
