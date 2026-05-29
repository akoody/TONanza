import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const csvBigIntIdsFromEnv = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => String(entry).split(","))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}, z.array(z.string().regex(/^[1-9][0-9]*$/)));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  ROUND_DURATION_SECONDS: z.coerce.number().int().positive().default(40),
  GAME_RAKE_BPS: z.coerce.number().int().min(0).max(9_999).default(400),
  APP_WALLET_ADDRESS: z.string().min(1),
  TONCENTER_BASE_URL: z.string().url().default("https://toncenter.com/api/v2/jsonRPC"),
  TONCENTER_API_KEY: z.string().default(""),
  WATCHER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(12000),
  WATCHER_POLL_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(50),
  WATCHER_POLL_MAX_PAGES: z.coerce.number().int().positive().max(100).default(12),
  WATCHER_CATCHUP_MAX_PAGES: z.coerce.number().int().positive().max(500).default(60),
  WATCHER_LOCK_TTL_MS: z.coerce.number().int().positive().default(60_000),
  WATCHER_RECOVER_FAILED_LIMIT: z.coerce.number().int().positive().max(1000).default(100),
  MIN_BET_NANOTONS: z.coerce.bigint().positive().default(100_000_000n),
  DEV_BOOTSTRAP_BALANCE_NANOTONS: z.coerce.bigint().nonnegative().default(100_000_000_000n),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.coerce.number().int().nonnegative().default(86_400),
  FRONTEND_URL: z.string().url().default("https://tonanza.online"),
  APP_WALLET_MNEMONIC: z.string().optional(),
  TRUST_PROXY_HEADERS: booleanFromEnv.default(false),
  SOCKET_MAX_HTTP_BUFFER_SIZE: z.coerce.number().int().positive().default(16_384),
  HTTP_RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
  HTTP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  HTTP_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(240),
  HTTP_RATE_LIMIT_BLOCK_MS: z.coerce.number().int().positive().default(120_000),
  HTTP_RATE_LIMIT_STATE_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
  SOCKET_CONNECT_RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
  SOCKET_CONNECT_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  SOCKET_CONNECT_RATE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(40),
  SOCKET_CONNECT_RATE_BLOCK_MS: z.coerce.number().int().positive().default(180_000),
  SOCKET_CONNECT_RATE_STATE_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
  SOCKET_EVENT_RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
  SOCKET_EVENT_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  SOCKET_EVENT_RATE_MAX_EVENTS: z.coerce.number().int().positive().default(120),
  SOCKET_EVENT_RATE_BLOCK_MS: z.coerce.number().int().positive().default(30_000),
  SOCKET_EVENT_RATE_STATE_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
  CHAT_ENABLED: booleanFromEnv.default(true),
  CHAT_COOLDOWN_MS: z.coerce.number().int().positive().default(10_000),
  CHAT_MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().max(500).default(160),
  CHAT_HISTORY_LIMIT: z.coerce.number().int().positive().max(500).default(100),
  CHAT_BUCKET_CAPACITY: z.coerce.number().int().positive().max(50).default(3),
  CHAT_BUCKET_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  CHAT_AUTO_MUTE_MS: z.coerce.number().int().positive().default(120_000),
  CHAT_ADMIN_USER_IDS: csvBigIntIdsFromEnv.default([])
});

export const env = envSchema.parse(process.env);
