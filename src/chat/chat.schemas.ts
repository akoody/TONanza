import { z } from "zod";

export const chatSendPayloadSchema = z
  .object({
    text: z.string().max(1024)
  })
  .strict();

export type ChatSendPayload = z.infer<typeof chatSendPayloadSchema>;

export const chatDeletePayloadSchema = z
  .object({
    messageId: z.string().min(1).max(64)
  })
  .strict();

export type ChatDeletePayload = z.infer<typeof chatDeletePayloadSchema>;

export const chatTogglePayloadSchema = z
  .object({
    enabled: z.boolean()
  })
  .strict();

export type ChatTogglePayload = z.infer<typeof chatTogglePayloadSchema>;
