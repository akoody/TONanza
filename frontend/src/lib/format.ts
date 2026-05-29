const NANOTONS_PER_TON = 1_000_000_000n;
const DEFAULT_MAX_FRACTION_DIGITS = 9;
const DISPLAY_FRACTION_DIGITS = 2;
const NANOTONS_PER_HUNDREDTH_TON = 10_000_000n;
const NANOTONS_PER_HUNDREDTH_KTON = 10_000_000_000n;
const NANOTONS_PER_KTON = 1_000_000_000_000n;

export const parseTonInputToNanotons = (value: string): bigint | null => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{0,9})?$/.test(normalized)) {
    return null;
  }

  const [wholePart, fractionPart = ""] = normalized.split(".");
  const whole = BigInt(wholePart);
  const fraction = BigInt((fractionPart + "000000000").slice(0, 9));

  const nanotons = whole * NANOTONS_PER_TON + fraction;
  return nanotons > 0n ? nanotons : null;
};

const formatFixedFraction = (whole: bigint, fraction: bigint, digits: number): string => {
  if (digits <= 0) return whole.toString();
  const fractionText = fraction.toString().padStart(digits, "0").replace(/0+$/, "");
  return fractionText.length > 0 ? `${whole.toString()}.${fractionText}` : whole.toString();
};

export const formatNanotonsToTon = (value: bigint): string => {
  return `${formatTonValue(value, DISPLAY_FRACTION_DIGITS)} TON`;
};

export const formatTonValue = (value: bigint, maxFractionDigits: number = DEFAULT_MAX_FRACTION_DIGITS): string => {
  const safeDigits = Number.isInteger(maxFractionDigits)
    ? Math.min(DEFAULT_MAX_FRACTION_DIGITS, Math.max(0, maxFractionDigits))
    : DEFAULT_MAX_FRACTION_DIGITS;

  const whole = value / NANOTONS_PER_TON;
  if (safeDigits === 0) {
    return whole.toString();
  }

  const fraction = (value % NANOTONS_PER_TON).toString().padStart(9, "0").slice(0, safeDigits);
  const trimmed = fraction.replace(/0+$/, "");
  if (!trimmed) {
    return whole.toString();
  }

  return `${whole.toString()}.${trimmed}`;
};

export const formatNanotonsForInput = (
  value: bigint,
  maxFractionDigits: number = DEFAULT_MAX_FRACTION_DIGITS
): string => {
  return formatTonValue(value, maxFractionDigits);
};

export const formatNanotonsBalance = (value: bigint): string => {
  return `${formatTonValue(value, DISPLAY_FRACTION_DIGITS)} TON`;
};

export const formatNanotonsCompact = (value: bigint): string => {
  if (value >= NANOTONS_PER_KTON) {
    const hundredthKton = value / NANOTONS_PER_HUNDREDTH_KTON;
    const wholeKton = hundredthKton / 100n;
    const fractionKton = hundredthKton % 100n;
    return `${formatFixedFraction(wholeKton, fractionKton, DISPLAY_FRACTION_DIGITS)}K TON`;
  }

  const hundredthTon = value / NANOTONS_PER_HUNDREDTH_TON;
  const wholeTon = hundredthTon / 100n;
  const fractionTon = hundredthTon % 100n;
  return `${formatFixedFraction(wholeTon, fractionTon, DISPLAY_FRACTION_DIGITS)} TON`;
};

export const randomColorByUserId = (userId: string): string => {
  const palette = [
    "#06b6d4",
    "#14b8a6",
    "#f97316",
    "#ec4899",
    "#facc15",
    "#6366f1",
    "#22c55e",
    "#fb7185"
  ];

  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }

  return palette[Math.abs(hash) % palette.length];
};
