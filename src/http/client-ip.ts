import type { FastifyRequest } from "fastify";
import { env, isDevToolsEnabled } from "../config/env.js";

const normalizeOrigin = (origin: string): string | null => {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
};

const allowedOrigins = new Set<string>();
const frontendOrigin = normalizeOrigin(env.FRONTEND_URL);
if (frontendOrigin) {
  allowedOrigins.add(frontendOrigin);
}
if (isDevToolsEnabled) {
  allowedOrigins.add("http://localhost:5173");
  allowedOrigins.add("http://127.0.0.1:5173");
  allowedOrigins.add("http://localhost:3000");
  allowedOrigins.add("http://127.0.0.1:3000");
}

export const isOriginAllowed = (origin?: string): boolean => {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowedOrigins.has(normalized);
};

const normalizeIp = (value: string | undefined | null): string => {
  if (!value) return "unknown";
  const first = value.split(",")[0]?.trim() ?? "";
  if (!first) return "unknown";
  return first.startsWith("::ffff:") ? first.slice(7) : first;
};

const extractForwardedIp = (headers: Record<string, unknown>): string | null => {
  const xForwardedFor = headers["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor.trim().length > 0) {
    return normalizeIp(xForwardedFor);
  }
  if (Array.isArray(xForwardedFor) && typeof xForwardedFor[0] === "string") {
    return normalizeIp(xForwardedFor[0]);
  }

  const xRealIp = headers["x-real-ip"];
  if (typeof xRealIp === "string" && xRealIp.trim().length > 0) {
    return normalizeIp(xRealIp);
  }
  if (Array.isArray(xRealIp) && typeof xRealIp[0] === "string") {
    return normalizeIp(xRealIp[0]);
  }

  return null;
};

export const getFastifyClientIp = (request: FastifyRequest): string => {
  if (env.TRUST_PROXY_HEADERS) {
    const forwarded = extractForwardedIp(request.headers as Record<string, unknown>);
    if (forwarded) return forwarded;
  }
  return normalizeIp(request.ip);
};

export const getSocketRequestIp = (request: {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string | null };
  connection?: { remoteAddress?: string | null };
}): string => {
  if (env.TRUST_PROXY_HEADERS) {
    const forwarded = extractForwardedIp(request.headers);
    if (forwarded) return forwarded;
  }

  const remoteAddress =
    request.socket?.remoteAddress ??
    request.connection?.remoteAddress ??
    null;
  return normalizeIp(remoteAddress);
};
