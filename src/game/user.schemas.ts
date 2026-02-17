import { z } from "zod";

const positiveBigIntString = z
  .string()
  .regex(/^[1-9][0-9]*$/, "Must be a positive integer string")
  .transform((value) => BigInt(value));

export const userSyncSchema = z.object({
  telegramId: positiveBigIntString,
  walletAddress: z.string().trim().min(1).max(128).optional()
});

export type UserSyncInput = z.infer<typeof userSyncSchema>;
