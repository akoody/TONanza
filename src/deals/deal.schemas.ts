import { z } from "zod";

export const createDealSchema = z.object({
  title: z.string().trim().min(2).max(120),
  terms: z.string().trim().min(5).max(2000),
  ownerRole: z.enum(["BUYER", "SELLER"]),
  amount: z.coerce.number().positive().max(100_000_000)
});

export const searchDealsSchema = z.object({
  q: z.string().trim().max(120).optional().default("")
});

export const dealCodeParamSchema = z.object({
  code: z.string().trim().min(4).max(12)
});

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(2000)
});

export const adminActionSchema = z.object({
  text: z.string().trim().min(1).max(2000)
});
