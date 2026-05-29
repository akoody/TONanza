import { z } from "zod";

const positiveBigIntString = z
  .string()
  .regex(/^[1-9][0-9]*$/, "Must be a positive integer string in nanotons")
  .transform((value) => BigInt(value));

export const placeBetSchema = z.object({
  userId: positiveBigIntString,
  amountNanotons: positiveBigIntString
});

export const cancelBetSchema = z.object({
  userId: positiveBigIntString
});

export const determineWinnerSchema = z.object({
  clientSeed: z.string().min(16).max(255).optional()
});

export const gameIdParamSchema = z.object({
  gameId: positiveBigIntString
});

export type PlaceBetInput = z.infer<typeof placeBetSchema>;
export type CancelBetInput = z.infer<typeof cancelBetSchema>;
export type DetermineWinnerInput = z.infer<typeof determineWinnerSchema>;
export type GameIdParams = z.infer<typeof gameIdParamSchema>;
