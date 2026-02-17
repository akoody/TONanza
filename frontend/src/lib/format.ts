const NANOTONS_PER_TON = 1_000_000_000n;

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

export const formatNanotonsToTon = (value: bigint): string => {
  const whole = value / NANOTONS_PER_TON;
  const fraction = value % NANOTONS_PER_TON;

  if (fraction === 0n) {
    return `${whole.toString()} TON`;
  }

  const fractionText = fraction.toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionText} TON`;
};

export const formatNanotonsCompact = (value: bigint): string => {
  const ton = Number(value / 1_000_000n) / 1_000;
  if (ton >= 1000) {
    return `${(ton / 1000).toFixed(2)}K TON`;
  }

  return `${ton.toFixed(2)} TON`;
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
