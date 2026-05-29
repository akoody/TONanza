import { z } from "zod";

const positiveBigIntString = z
  .string()
  .regex(/^[1-9][0-9]*$/, "Must be a positive integer string")
  .transform((value) => BigInt(value));

const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;

const sanitizeProfileText = (value: string) =>
  value.replace(CONTROL_CHARS_REGEX, "").replace(/[<>]/g, "").trim();

const optionalProfileField = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => sanitizeProfileText(value))
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined));

const optionalAvatarUrlField = z
  .string()
  .trim()
  .max(512)
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined;

    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "avatarUrl must use http or https"
        });
        return z.NEVER;
      }
      return parsed.toString();
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "avatarUrl must be a valid URL"
      });
      return z.NEVER;
    }
  });

const optionalWalletAddressField = z
  .string()
  .trim()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, "walletAddress contains unsupported characters")
  .optional();

export const userSyncSchema = z.object({
  telegramId: positiveBigIntString,
  walletAddress: optionalWalletAddressField,
  username: optionalProfileField(64),
  avatarUrl: optionalAvatarUrlField,
  startParam: optionalProfileField(128)
});

export type UserSyncInput = z.infer<typeof userSyncSchema>;
