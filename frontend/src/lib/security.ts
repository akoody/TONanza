const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;
const CONTROL_CHARS_EXT_REGEX = /[\u0000-\u001F\u007F-\u009F]/g;
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g;
const BIDI_CONTROL_REGEX = /[\u202A-\u202E\u2066-\u2069]/g;

export const sanitizeDisplayName = (input: unknown, fallback: string = "Unknown"): string => {
  if (typeof input !== "string") return fallback;

  const cleaned = input
    .replace(CONTROL_CHARS_REGEX, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 64);

  return cleaned.length > 0 ? cleaned : fallback;
};

export const sanitizeAvatarUrl = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value || value.length > 512) return undefined;

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
};

export const parseSafeBigInt = (input: unknown, fallback: bigint = 0n): bigint => {
  if (typeof input === "bigint") {
    return input >= 0n ? input : fallback;
  }

  if (typeof input === "number" && Number.isSafeInteger(input) && input >= 0) {
    return BigInt(input);
  }

  if (typeof input === "string" && /^\d+$/.test(input)) {
    try {
      return BigInt(input);
    } catch {
      return fallback;
    }
  }

  return fallback;
};

export const sanitizeChatText = (input: unknown, maxLength: number = 160): string => {
  if (typeof input !== "string") return "";

  const normalized = input.normalize("NFKC");
  const collapsed = normalized
    .replace(CONTROL_CHARS_EXT_REGEX, "")
    .replace(ZERO_WIDTH_REGEX, "")
    .replace(BIDI_CONTROL_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!collapsed) return "";
  const points = Array.from(collapsed);
  if (points.length <= maxLength) return collapsed;
  return points.slice(0, maxLength).join("");
};
