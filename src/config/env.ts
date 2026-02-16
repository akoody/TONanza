import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  ROUND_DURATION_SECONDS: z.coerce.number().int().positive().default(90),
  APP_WALLET_ADDRESS: z.string().min(1),
  TONCENTER_BASE_URL: z.string().url().default("https://toncenter.com/api/v2/jsonRPC"),
  TONCENTER_API_KEY: z.string().default(""),
  WATCHER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(12000)
});

export const env = envSchema.parse(process.env);
