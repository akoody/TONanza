const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F-\u009F]/g;
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g;
const BIDI_CONTROL_REGEX = /[\u202A-\u202E\u2066-\u2069]/g;

const collapseWhitespace = (input: string) => input.replace(/\s+/g, " ").trim();

const limitByCodePoints = (input: string, maxLength: number): string => {
  const points = Array.from(input);
  if (points.length <= maxLength) return input;
  return points.slice(0, maxLength).join("");
};
export const sanitizeChatText = (input: unknown, maxLength: number): string => {
  if (typeof input !== "string") return "";

  const normalized = input.normalize("NFKC");
  const cleaned = collapseWhitespace(
    normalized
      .replace(CONTROL_CHARS_REGEX, "")
      .replace(ZERO_WIDTH_REGEX, "")
      .replace(BIDI_CONTROL_REGEX, "")
  );

  if (!cleaned) return "";
  return limitByCodePoints(cleaned, maxLength);
};

export const sanitizeChatDisplayName = (input: unknown, fallback: string): string => {
  if (typeof input !== "string") return fallback;
  const cleaned = input
    .normalize("NFKC")
    .replace(CONTROL_CHARS_REGEX, "")
    .replace(ZERO_WIDTH_REGEX, "")
    .replace(BIDI_CONTROL_REGEX, "")
    .replace(/[<>]/g, "")
    .trim();
  if (!cleaned) return fallback;
  return limitByCodePoints(cleaned, 64);
};

export const sanitizeChatAvatarUrl = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value || value.length > 512) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
};
