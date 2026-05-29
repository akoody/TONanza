import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  FRONTEND_URL: z.string().url().optional().or(z.literal("")),
  TELEGRAM_BOT_TOKEN: z.string().optional().or(z.literal("")),
  ADMIN_TELEGRAM_IDS: z.string().optional().default(""),
  CORS_ORIGINS: z.string().optional().default(""),
  UPLOAD_DIR: z.string().min(1).default("./uploads"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(25).default(8)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const parseAdminIds = (value: string): Set<string> =>
  new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^[1-9]\d*$/.test(entry))
  );

export const env = {
  ...parsed.data,
  ADMIN_IDS: parseAdminIds(parsed.data.ADMIN_TELEGRAM_IDS),
  MAX_UPLOAD_BYTES: parsed.data.MAX_UPLOAD_MB * 1024 * 1024
};
